"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ModelPicker } from "@/components/model-picker";
import { VoiceToggle } from "@/components/voice-toggle";
import { GestureToggle } from "@/components/gesture-toggle";
import { AiOrb, type OrbState } from "@/components/ai-orb";
import { AgentToolPart, type AnyToolPart } from "@/components/agent-tool-part";
import { ReasoningPart } from "@/components/reasoning-part";
import { SessionList } from "@/components/session-list";
import { DEFAULT_MODEL } from "@/lib/models";
import {
  isSpeechSupported,
  useSpeak,
  useWakeWordListener,
  useLocalWakeWordListener,
  type SttEngine,
} from "@/lib/use-speech";
import { useGestureControl, type GestureAction } from "@/lib/use-gesture";
import {
  type ChatSession,
  type VoiceEngine,
  loadSessions,
  saveSession,
  deleteSession as deleteStoredSession,
  deriveTitle,
  loadSettings,
  saveSettings,
} from "@/lib/chat-storage";

const DEFAULT_WORKSPACE = "G:\\my assistant";

function newSession(): ChatSession {
  return { id: crypto.randomUUID(), title: "New chat", messages: [], updatedAt: Date.now() };
}

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>("local");
  const [sttEngine, setSttEngine] = useState<SttEngine>("local");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // One-time load from localStorage on mount — a legitimate external-system sync that can't
  // run during render (localStorage isn't available server-side / at initial hydration).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const stored = loadSessions();
    const settings = loadSettings();
    if (settings) {
      setModel(settings.model);
      setWorkspace(settings.workspace);
      if (settings.voiceEngine) setVoiceEngine(settings.voiceEngine);
      if (settings.sttEngine) setSttEngine(settings.sttEngine);
    }
    const initial = stored.length > 0 ? stored : [newSession()];
    setSessions(initial);
    setActiveId(initial[0].id);
    setSettingsLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings({ model, workspace, voiceEngine, sttEngine });
  }, [settingsLoaded, model, workspace, voiceEngine, sttEngine]);

  const activeSession = sessions.find((s) => s.id === activeId);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { model, workspaceRoot: workspace },
      }),
    [model, workspace]
  );

  const { messages, sendMessage, addToolApprovalResponse, status, error, stop: stopChat } = useChat({
    id: activeId || "pending",
    messages: activeSession?.messages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  // Only the most recent message can have a live approval prompt — used to route a gesture-based
  // approve/deny to the right tool call without the user needing to click anything.
  const pendingApprovalId = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last) return null;
    for (const part of last.parts) {
      const p = part as unknown as AnyToolPart;
      if (p.state === "approval-requested" && p.approval && !p.approval.isAutomatic) {
        return p.approval.id;
      }
    }
    return null;
  }, [messages]);

  // Persist the active session's messages whenever they change — mirrors useChat's internal
  // state out to localStorage and into the session list, an external-system sync.
  useEffect(() => {
    if (!settingsLoaded || !activeId || messages.length === 0) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const updated: ChatSession = {
      id: activeId,
      title: deriveTitle(messages),
      messages,
      updatedAt: Date.now(),
    };
    saveSession(updated);
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === activeId);
      if (idx === -1) return [updated, ...prev];
      if (
        prev[idx].title === updated.title &&
        prev[idx].messages.length === updated.messages.length
      ) {
        return prev;
      }
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [messages, activeId, settingsLoaded]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const isBusy = status === "streaming" || status === "submitted";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isBusy) return;
    sendMessage({ text: input });
    setInput("");
  }

  // Interrupts an in-flight response and any TTS currently reading it aloud — covers both the
  // text-streaming case and the voice-mode case with a single control.
  function stopEverything() {
    stopChat();
    stopSpeaking();
  }

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [groqTtsAvailable, setGroqTtsAvailable] = useState(false);
  const lastSpokenIdRef = useRef<string | null>(null);

  // isSpeechSupported() reads `window` — check after mount, not during render, to avoid an
  // SSR/hydration mismatch.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setVoiceSupported(isSpeechSupported());
    fetch("/api/tts")
      .then((res) => res.json())
      .then((data) => setGroqTtsAvailable(Boolean(data.available)))
      .catch(() => setGroqTtsAvailable(false));
  }, []);

  const { speak, status: ttsStatus, speaking, modelLoadPercent, stop: stopSpeaking } = useSpeak();
  const ttsBusy = ttsStatus !== "idle"; // loading-model, generating, or speaking

  const handleVoiceCommand = useCallback(
    (text: string) => {
      sendMessage({ text });
    },
    [sendMessage]
  );

  // Both listener hooks are always called (Rules of Hooks) — only the one matching sttEngine
  // is actually enabled, the other sits idle. Their state/error/progress are merged below.
  const listenerPaused = ttsBusy || isBusy;
  const browserListener = useWakeWordListener({
    enabled: voiceEnabled && sttEngine === "browser",
    paused: listenerPaused,
    onCommand: handleVoiceCommand,
  });
  const localListener = useLocalWakeWordListener({
    enabled: voiceEnabled && sttEngine === "local",
    paused: listenerPaused,
    onCommand: handleVoiceCommand,
  });
  const activeListener = sttEngine === "local" ? localListener : browserListener;
  const voiceState = activeListener.state;
  const voiceError = activeListener.error;
  const sttModelLoadPercent = sttEngine === "local" ? localListener.modelLoadPercent : null;

  // Speak the assistant's reply out loud once it finishes streaming, but only once per message.
  useEffect(() => {
    if (!voiceEnabled || isBusy) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || lastSpokenIdRef.current === last.id) return;
    const text = last.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      .trim();
    lastSpokenIdRef.current = last.id;
    if (text) speak(text, voiceEngine);
  }, [messages, isBusy, voiceEnabled, speak, voiceEngine]);

  function toggleVoice() {
    setVoiceEnabled((prev) => {
      if (prev) stopSpeaking();
      return !prev;
    });
  }

  const [gestureEnabled, setGestureEnabled] = useState(false);

  // Stable callback identity isn't required — useGestureControl stashes the latest version in a
  // ref, so a fresh closure each render is fine and always sees current pendingApprovalId.
  function handleGestureAction(action: GestureAction) {
    if (action === "stop") stopEverything();
    else if (action === "toggleMic") toggleVoice();
    else if (pendingApprovalId) {
      addToolApprovalResponse({ id: pendingApprovalId, approved: action === "approve" });
    }
  }

  const {
    videoRef: gestureVideoRef,
    state: gestureState,
    error: gestureError,
    lastGesture,
  } = useGestureControl({ enabled: gestureEnabled, onAction: handleGestureAction });

  const heroOrbState: OrbState = speaking
    ? "speaking"
    : isBusy || ttsStatus === "loading-model" || ttsStatus === "generating"
      ? "thinking"
      : voiceState === "command-listening"
        ? "listening"
        : "idle";

  function handleNewChat() {
    const session = newSession();
    saveSession(session);
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    setShowSessions(false);
  }

  function handleSelect(id: string) {
    if (id !== activeId) setActiveId(id);
    setShowSessions(false);
  }

  function handleDelete(id: string) {
    deleteStoredSession(id);
    const next = sessions.filter((s) => s.id !== id);

    if (id !== activeId) {
      setSessions(next);
      return;
    }
    if (next.length > 0) {
      setActiveId(next[0].id);
      setSessions(next);
      return;
    }
    // Side effects (UUID generation, localStorage write) must happen here, not inside a
    // setState updater — React Strict Mode double-invokes updater functions in dev to catch
    // impurities, which was silently writing two orphaned fallback sessions to localStorage.
    const fallback = newSession();
    saveSession(fallback);
    setActiveId(fallback.id);
    setSessions([fallback]);
  }

  return (
    <div
      className={`shrink-0 overflow-hidden border-l border-white/10 bg-zinc-950 transition-[width] duration-200 ease-out ${
        open ? "fixed inset-0 z-40 w-full sm:static sm:z-auto sm:w-[420px]" : "w-0"
      }`}
    >
      <div className="flex h-full w-full flex-col sm:w-[420px]">
        <header className="relative flex flex-col gap-2 border-b border-white/10 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-medium text-zinc-300">Chat</h1>
            <button
              type="button"
              onClick={() => setShowSessions((v) => !v)}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            >
              🕘 History
            </button>
            <button
              type="button"
              onClick={handleNewChat}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            >
              + New
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close chat panel"
              className="ml-auto rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>

          {showSessions && (
            <div className="absolute left-3 right-3 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-xl">
              <SessionList
                sessions={sessions}
                activeId={activeId}
                onSelect={handleSelect}
                onNew={handleNewChat}
                onDelete={handleDelete}
              />
            </div>
          )}

          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            spellCheck={false}
            placeholder="Workspace path"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-xs text-zinc-300 outline-none focus:border-white/30"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <ModelPicker value={model} onChange={setModel} />
            <VoiceToggle
              enabled={voiceEnabled}
              state={voiceState}
              ttsStatus={ttsStatus}
              modelLoadPercent={modelLoadPercent ?? sttModelLoadPercent}
              error={voiceError}
              onToggle={toggleVoice}
            />
            <GestureToggle
              enabled={gestureEnabled}
              onToggle={() => setGestureEnabled((prev) => !prev)}
              state={gestureState}
              error={gestureError}
              lastGesture={lastGesture}
              videoRef={gestureVideoRef}
            />
            {voiceEnabled && voiceSupported && (
              <button
                type="button"
                onClick={() => setSttEngine((prev) => (prev === "local" ? "browser" : "local"))}
                title={
                  sttEngine === "local"
                    ? "Listening via local Whisper (private, fully offline) — click to switch to the browser's faster cloud recognizer"
                    : "Listening via the browser's SpeechRecognition (fast, but sends audio to Google) — click to switch to fully local Whisper"
                }
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-white/10"
              >
                {sttEngine === "local" ? "Listen: Local" : "Listen: Fast"}
              </button>
            )}
            {voiceEnabled && groqTtsAvailable && (
              <button
                type="button"
                onClick={() => setVoiceEngine((prev) => (prev === "local" ? "groq" : "local"))}
                title={
                  voiceEngine === "groq"
                    ? "Voice replies via Groq cloud TTS (faster, more natural — leaves the machine)"
                    : "Voice replies via local TTS (private, fully offline)"
                }
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-white/10"
              >
                {voiceEngine === "groq" ? "Voice: Fast" : "Voice: Local"}
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-zinc-500">
              <AiOrb state={heroOrbState} size={72} />
              <div className="text-sm font-medium text-zinc-300">Ask, build, or fix — all in one place</div>
              <div className="max-w-xs text-xs">
                Talk normally, ask for an app (previewed live), or point it at the workspace path above to
                explore, edit, and run real code. Writes and commands ask for your approval first.
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <div key={message.id} className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {message.role === "user" ? "You" : "OmniAI"}
                </div>
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return (
                      <div
                        key={`${message.id}-${i}`}
                        className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-relaxed text-zinc-100"
                      >
                        {part.text}
                      </div>
                    );
                  }
                  if (part.type === "reasoning") {
                    return <ReasoningPart key={`${message.id}-${i}`} text={part.text} state={part.state} />;
                  }
                  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                    return (
                      <AgentToolPart
                        key={`${message.id}-${i}`}
                        part={part as unknown as AnyToolPart}
                        onApprove={(id) => addToolApprovalResponse({ id, approved: true })}
                        onDeny={(id) => addToolApprovalResponse({ id, approved: false })}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            ))}
            {isBusy && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <AiOrb state="thinking" size={20} />
                Working…
                <button
                  type="button"
                  onClick={stopEverything}
                  className="ml-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/10"
                >
                  Stop
                </button>
              </div>
            )}
            {speaking && !isBusy && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <AiOrb state="speaking" size={20} />
                Speaking…
                <button
                  type="button"
                  onClick={stopEverything}
                  className="ml-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/10"
                >
                  Stop
                </button>
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error.message}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <form onSubmit={submit} className="border-t border-white/10 px-3 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(e);
                }
              }}
              rows={1}
              placeholder="Ask anything…"
              className="flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-white/30"
            />
            <button
              type="submit"
              disabled={isBusy || !input.trim()}
              className="rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 px-3.5 py-2.5 text-sm font-medium text-zinc-950 transition-opacity disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
