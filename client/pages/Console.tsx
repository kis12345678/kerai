import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  Mic,
  MicOff,
  Send,
  Sparkles,
  User,
  Trash2,
  Volume2,
  VolumeX,
  Loader2,
  PersonStanding,
  UserRound,
  Music,
  Timer,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CommandResponse, CommandAction, WraithPersona, VoiceStyle, WraithSettings } from "@shared/api";

const INTRO: CommandResponse[] = [
  {
    id: "intro-1",
    role: "wraith",
    text: "Hey Kishan 👋 I'm here. You can talk to me about anything — your day, how you're feeling, or if you need me to handle something. What's on your mind?",
    timestamp: new Date().toISOString(),
  },
];

const QUICK_REPLIES = [
  "How are you doing?",
  "I'm feeling a bit down",
  "Check my emails",
  "What's on my calendar?",
  "Tell me something fun",
];

// ── Web Speech API types ────────────────────────────────────────

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Server TTS audio cache to avoid re-generating for repeated messages
const ttsCache = new Map<string, string>();
let currentAudio: HTMLAudioElement | null = null;

function speak(text: string, onEnd?: () => void, persona: WraithPersona = "female", voiceStyle: VoiceStyle = "warm") {
  // Cancel any previous playback
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();

  const clean = text.replace(/[\u{1F600}-\u{1F9FF}]/gu, "").trim();
  if (!clean) return;

  // Try server Gemini TTS first
  const cacheKey = `${persona}:${voiceStyle}:${clean}`;
  const cached = ttsCache.get(cacheKey);

  if (cached) {
    playAudioBase64(cached, onEnd);
    return;
  }

  fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clean, persona, voiceStyle }),
  })
    .then(async (res) => {
      if (res.status === 204) {
        // No audio returned, fall back to browser TTS
        speakBrowser(clean, onEnd);
        return;
      }
      if (!res.ok) throw new Error("TTS request failed");
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        // Extract base64 data
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          ttsCache.set(cacheKey, base64);
          playAudioBase64(base64, onEnd);
        } else {
          speakBrowser(clean, onEnd);
        }
      };
      reader.readAsDataURL(blob);
    })
    .catch(() => {
      // Fall back to browser TTS on error
      speakBrowser(clean, onEnd);
    });
}

function playAudioBase64(base64: string, onEnd?: () => void) {
  const audio = new Audio(`data:audio/wav;base64,${base64}`);
  currentAudio = audio;
  audio.onended = () => {
    currentAudio = null;
    onEnd?.();
  };
  audio.onerror = () => {
    currentAudio = null;
    onEnd?.();
  };
  audio.play().catch(() => {
    currentAudio = null;
    onEnd?.();
  });
}

function speakBrowser(text: string, onEnd?: () => void) {
  if (!window.speechSynthesis) { onEnd?.(); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  utterance.onend = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

// ── Stream a command via SSE ────────────────────────────────────

async function streamCommand(
  text: string,
  onChunk: (chunk: string) => void,
  onDone: (id: string, action?: CommandAction, fullText?: string) => void,
  onError: (err: string) => void,
) {
  const res = await fetch("/api/commands/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok || !res.body) {
    onError("Failed to connect to WRAITH");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "chunk") {
          onChunk(event.text);
        } else if (event.type === "done") {
          onDone(event.id, event.action, event.fullText);
        } else if (event.type === "error") {
          onError(event.error);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}

export default function Console() {
  const [messages, setMessages] = useState<CommandResponse[]>(INTRO);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [persona, setPersona] = useState<WraithPersona>("female");
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>("warm");
  const [voiceDelay, setVoiceDelay] = useState(600);

  // Fetch settings to get persona + voiceStyle
  const { data: settings } = useQuery<WraithSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.json();
    },
  });

  // Sync persona, voiceStyle, and voiceDelay from settings
  useEffect(() => {
    if (settings?.persona) setPersona(settings.persona);
    if (settings?.voiceStyle) setVoiceStyle(settings.voiceStyle);
    if (settings?.voiceDelay != null) setVoiceDelay(settings.voiceDelay);
  }, [settings]);

  // Toggle persona
  const togglePersona = useMutation({
    mutationFn: async (newPersona: WraithPersona) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: newPersona }),
      });
      if (!res.ok) throw new Error("Failed to update persona");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // Update voice style
  const updateVoiceStyle = useMutation({
    mutationFn: async (newStyle: VoiceStyle) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceStyle: newStyle }),
      });
      if (!res.ok) throw new Error("Failed to update voice style");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // Update voice delay
  const updateVoiceDelay = useMutation({
    mutationFn: async (delay: number) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceDelay: delay }),
      });
      if (!res.ok) throw new Error("Failed to update voice delay");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamAction, setStreamAction] = useState<CommandAction | undefined>();
  const [streamId, setStreamId] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const queryClient = useQueryClient();
  const autoSendRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Speech Recognition setup ───────────────────────────────────

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }

      if (final) {
        setTranscript(final);
        setInterimTranscript("");
      } else {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => { recognition.abort(); };
  }, []);

  // ── Auto-send after recognition ends ───────────────────────────

  useEffect(() => {
    if (!listening && transcript && autoSendRef.current) {
      autoSendRef.current = false;
      sendMessage(transcript);
      setTranscript("");
    }
  }, [listening, transcript]);

  // ── Toggle listening ───────────────────────────────────────────

  function toggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      toast.error("Voice input not supported in this browser");
      return;
    }

    if (listening) {
      recognition.stop();
      setListening(false);
    } else {
      setTranscript("");
      setInterimTranscript("");
      autoSendRef.current = true;
      recognition.start();
      setListening(true);
    }
  }

  // ── Stop WRAITH from speaking ──────────────────────────────────

  function stopSpeaking() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = "";
      currentAudio = null;
    }
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  // ── Send message via stream ────────────────────────────────────

  function sendMessage(text: string) {
    if (isStreaming) return;

    stopSpeaking();
    const userMsg: CommandResponse = {
      id: `temp-${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Start streaming
    setIsStreaming(true);
    setStreamText("");
    setStreamAction(undefined);
    setStreamId(null);

    streamCommand(
      text,
      // onChunk
      (chunk) => {
        setStreamText((prev) => prev + chunk);
      },
      // onDone
      (id, action, fullText) => {
        setStreamId(id);
        setStreamAction(action);
        setIsStreaming(false);

        // Add the final message
        const finalMsg: CommandResponse = {
          id,
          role: "wraith",
          text: fullText || streamText,
          timestamp: new Date().toISOString(),
          action,
        };
        setMessages((prev) => [...prev, finalMsg]);
        setStreamText("");
        queryClient.invalidateQueries({ queryKey: ["logs"] });        // Speak the response after a brief delay so the text appears first
        if (voiceEnabled && fullText) {
          setTimeout(() => {
            setSpeaking(true);
            speak(fullText, () => setSpeaking(false), persona, voiceStyle);
          }, voiceDelay);
        }
      },
      // onError
      (err) => {
        setIsStreaming(false);
        setStreamText("");
        toast.error(err || "Something went wrong. Try again?");
      },
    );
  }

  // ── Clear conversation mutation ─────────────────────────────────

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/commands/clear", { method: "POST" });
      if (!res.ok) throw new Error("Failed to clear conversation");
    },
    onSuccess: () => {
      setMessages(INTRO);
      stopSpeaking();
      setIsStreaming(false);
      setStreamText("");
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Fresh start 🌟");
    },
    onError: () => {
      toast.error("Failed to clear conversation");
    },
  });

  // ── Scroll + auto-scroll ───────────────────────────────────────

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // ── Cleanup on unmount ─────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  // ── Handlers ───────────────────────────────────────────────────

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput("");
  }

  function handleQuickReply(text: string) {
    if (isStreaming) return;
    sendMessage(text);
  }

  // ── Export conversation as Markdown ─────────────────────────

  function exportChat() {
    const lines: string[] = [];
    lines.push("# WRAITH Conversation");
    lines.push("");
    lines.push(`*Exported on ${new Date().toLocaleString()}*`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const msg of messages) {
      const sender = msg.role === "user" ? "**You**" : "**WRAITH**";
      const time = new Date(msg.timestamp).toLocaleString();
      lines.push(`### ${sender}  _${time}_`);
      lines.push("");
      lines.push(msg.text);
      if (msg.action) {
        lines.push("");
        lines.push(`> 📎 Action: ${msg.action.type}${msg.action.target ? ` → ${msg.action.target}` : ""}${msg.action.result ? ` — ${msg.action.result}` : ""}`);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wraith-conversation-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Conversation exported as Markdown");
  }

  const isRecording = listening || interimTranscript.length > 0;
  const showThinking = isStreaming && !streamText;

  return (
    <AppLayout>
      <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-secondary/30">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-success" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold">WRAITH</h1>
              <p className="text-xs text-success">
                {speaking ? "speaking..." : isStreaming ? "thinking..." : listening ? "listening..." : "online"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Persona toggle */}
            <button
              onClick={() => {
                const next = persona === "female" ? "male" : "female";
                setPersona(next);
                togglePersona.mutate(next);
              }}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors",
                "border border-border text-muted-foreground hover:text-foreground hover:border-primary/40",
              )}
              aria-label="Switch persona"
            >
              {persona === "female" ? (
                <><PersonStanding className="h-3.5 w-3.5" /> She</>
              ) : (
                <><UserRound className="h-3.5 w-3.5" /> He</>
              )}
            </button>

            {/* Voice style picker */}
            <div className="relative group">
              <button
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors",
                  "border border-border text-muted-foreground hover:text-foreground hover:border-primary/40",
                )}
                aria-label="Voice style"
              >
                <Music className="h-3.5 w-3.5" />
                <span className="capitalize">{voiceStyle}</span>
              </button>
              <div className="absolute right-0 top-full z-50 mt-1 hidden w-44 rounded-xl border border-border bg-card p-2 shadow-lg group-hover:block">
                <p className="mb-1 px-2 text-[10px] font-medium uppercase text-muted-foreground/60">Voice Style</p>
                {(["warm", "energetic", "calm", "whisper"] as VoiceStyle[]).map((style) => (
                  <button
                    key={style}
                    onClick={() => {
                      setVoiceStyle(style);
                      updateVoiceStyle.mutate(style);
                    }}
                    className={cn(
                      "w-full rounded-lg px-3 py-1.5 text-left text-xs transition-colors",
                      voiceStyle === style
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {style.charAt(0).toUpperCase() + style.slice(1)}
                  </button>
                ))}
                <div className="my-1.5 border-t border-border" />
                <div className="px-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground/60">
                      <Timer className="h-3 w-3" /> Delay
                    </span>
                    <span className="text-[10px] text-muted-foreground">{voiceDelay}ms</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3000}
                    step={100}
                    value={voiceDelay}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setVoiceDelay(val);
                    }}
                    onMouseUp={(e) => {
                      // Save the actual slider value, not stale state
                      const val = Number((e.target as HTMLInputElement).value);
                      updateVoiceDelay.mutate(val);
                    }}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setVoiceEnabled((v) => !v);
                if (voiceEnabled) stopSpeaking();
              }}
              className={cn(
                "rounded-full p-2 transition-colors",
                voiceEnabled
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={voiceEnabled ? "Mute voice" : "Enable voice"}
            >
              {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>

            <button
              onClick={toggleListening}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-mono transition-all duration-300",
                isRecording
                  ? "bg-primary/15 text-primary shadow-[0_0_20px_hsl(var(--glow-violet)/0.3)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="relative flex h-2.5 w-2.5">
                {isRecording && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                )}
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              {isRecording ? "Listening" : "Voice"}
            </button>

            <button
              onClick={exportChat}
              disabled={messages.length <= 1}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
              aria-label="Export conversation"
              title="Export as Markdown"
            >
              <Download className="h-4 w-4" />
            </button>

            <button
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear conversation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card/50 p-4 sm:p-6">
          {/* Rendered messages */}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex items-end gap-2",
                m.role === "user" && "flex-row-reverse",
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  m.role === "wraith"
                    ? "bg-gradient-to-br from-primary/30 to-secondary/20 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {m.role === "wraith" ? (
                  <Sparkles className="h-3.5 w-3.5" />
                ) : (
                  <User className="h-3.5 w-3.5" />
                )}
              </div>

              <div className="max-w-[80%] space-y-1">
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "wraith"
                      ? "rounded-bl-md bg-muted text-foreground"
                      : "rounded-br-md bg-primary text-primary-foreground",
                  )}
                >
                  {m.text}
                  {m.action && (
                    <div className="mt-1.5 rounded-lg bg-background/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <span className="font-mono text-secondary">{m.action.type}</span>
                      {m.action.target && (
                        <> → <span className="font-mono">{m.action.target}</span></>
                      )}
                      {m.action.result && (
                        <span className="ml-1 text-success">✓ {m.action.result}</span>
                      )}
                    </div>
                  )}
                </div>

                <div
                  className={cn(
                    "flex items-center gap-2 px-1",
                    m.role === "user" && "justify-end",
                  )}
                >
                  <p className="text-[10px] text-muted-foreground/60">
                    {formatTime(m.timestamp)}
                  </p>
                  {m.role === "wraith" && (
                    <button
                      onClick={() => {
                        if (speaking) {
                          stopSpeaking();
                        } else {
                          setSpeaking(true);                           speak(m.text, () => setSpeaking(false), persona, voiceStyle);
                        }
                      }}
                      className="text-muted-foreground/40 transition-colors hover:text-primary"
                      aria-label="Read aloud"
                    >
                      {speaking ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Live streaming bubble */}
          {isStreaming && streamText && (
            <div className="flex items-end gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-secondary/20 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="max-w-[80%] space-y-1">
                <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
                  {streamText}
                  <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-primary align-middle" />
                </div>
              </div>
            </div>
          )}

          {/* Thinking indicator — shown before first chunk */}
          {showThinking && (
            <div className="flex items-end gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-secondary/20 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-3">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Live voice transcript */}
          {isRecording && (
            <div className="flex items-end gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                <Mic className="h-3.5 w-3.5" />
              </div>
              <div className="rounded-2xl rounded-bl-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary/80">
                {interimTranscript || transcript || (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    listening...
                  </span>
                )}
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Quick replies */}
        {messages.length <= 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply}
                onClick={() => handleQuickReply(reply)}
                disabled={isStreaming}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        {/* Input bar */}
        <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleListening}
            className={cn(
              "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
              isRecording
                ? "border-primary bg-primary/15 text-primary shadow-[0_0_24px_hsl(var(--glow-violet)/0.5)]"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            aria-label="Toggle voice input"
          >
            {isRecording && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/20" />
            )}
            {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          <div className="flex flex-1 items-center rounded-2xl border border-border bg-background/60 px-4">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening..." : isStreaming ? "WRAITH is responding..." : "Say anything..."}
              disabled={isStreaming}
              className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
              aria-label="Send"
            >
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>

          {speaking && (
            <button
              type="button"
              onClick={stopSpeaking}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
              aria-label="Stop speaking"
            >
              <VolumeX className="h-5 w-5" />
            </button>
          )}
        </form>
      </div>
    </AppLayout>
  );
}
