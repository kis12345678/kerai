"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadLocalTts, synthesizeSpeech } from "./local-tts";
import { loadLocalStt, transcribeAudio } from "./local-stt";
import type { MicVAD } from "@ricky0123/vad-web";

const WAKE_WORD = "jarvis";
const SILENCE_MS_TO_END_COMMAND = 1200;

export type VoiceState = "idle" | "wake-listening" | "command-listening";
export type SttEngine = "local" | "browser";

function getRecognitionCtor(): (typeof SpeechRecognition) | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

// Voice *input* (wake word + transcription) still needs the browser's SpeechRecognition API —
// voice *output* no longer depends on it, since useSpeak now runs its own local TTS model.
export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && Boolean(getRecognitionCtor());
}

/**
 * Continuously listens for the wake word "Jarvis", then captures whatever is said next (up to
 * a pause) as a command and hands it to onCommand. Set `paused` while the assistant is busy or
 * speaking so the mic doesn't pick up its own TTS output or overlap with an in-flight request.
 */
export function useWakeWordListener({
  enabled,
  paused,
  onCommand,
}: {
  enabled: boolean;
  paused: boolean;
  onCommand: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const modeRef = useRef<"wake" | "command">("wake");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandBufferRef = useRef("");
  const stoppedIntentionallyRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || paused) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setState("idle");
      return;
    }

    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition isn't supported in this browser — try Chrome or Edge.");
      return;
    }

    stoppedIntentionallyRef.current = false;
    modeRef.current = "wake";
    commandBufferRef.current = "";
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    function finishCommand() {
      clearSilenceTimer();
      const text = commandBufferRef.current.trim();
      commandBufferRef.current = "";
      modeRef.current = "wake";
      setState("wake-listening");
      if (text) onCommandRef.current(text);
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (modeRef.current === "wake") {
          const lower = transcript.toLowerCase();
          const wakeIndex = lower.indexOf(WAKE_WORD);
          if (wakeIndex !== -1 && result.isFinal) {
            const after = lower.slice(wakeIndex + WAKE_WORD.length).replace(/^[,.\s]+/, "");
            modeRef.current = "command";
            commandBufferRef.current = after;
            setState("command-listening");
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(finishCommand, SILENCE_MS_TO_END_COMMAND);
          }
        } else {
          if (result.isFinal) {
            commandBufferRef.current = `${commandBufferRef.current} ${transcript}`.trim();
          }
          clearSilenceTimer();
          silenceTimerRef.current = setTimeout(finishCommand, SILENCE_MS_TO_END_COMMAND);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was denied.");
      }
    };

    recognition.onend = () => {
      // Chrome ends "continuous" sessions on its own after a while even with no error —
      // restart transparently unless we're the ones who told it to stop.
      if (!stoppedIntentionallyRef.current) {
        try {
          recognition.start();
        } catch {
          // already starting/started — ignore
        }
      }
    };

    setState("wake-listening");
    setError(null);
    try {
      recognition.start();
    } catch {
      // ignore duplicate start
    }

    return () => {
      stoppedIntentionallyRef.current = true;
      recognition.onend = null;
      recognition.stop();
      clearSilenceTimer();
    };
  }, [enabled, paused, clearSilenceTimer]);

  return { state, error };
}

/**
 * Same external contract as useWakeWordListener (wake word "Jarvis", then capture a command),
 * but fully local: @ricky0123/vad-web (Silero VAD compiled to ONNX/WASM) cheaply detects when
 * you start/stop talking, and only the resulting speech segment is transcribed — by a local
 * Whisper model (also ONNX/WASM), not a cloud API. No audio ever leaves the machine.
 *
 * Tradeoff vs the browser engine: there's no equivalent of live interim results, since Whisper
 * only sees a segment once VAD decides you've stopped talking — so "was the wake word said"
 * isn't known until a beat after you finish the phrase. Real, but modest (VAD's silence padding
 * plus a Whisper pass on a few seconds of audio) — the fully-local guarantee is the trade.
 */
export function useLocalWakeWordListener({
  enabled,
  paused,
  onCommand,
}: {
  enabled: boolean;
  paused: boolean;
  onCommand: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [modelLoadPercent, setModelLoadPercent] = useState<number | null>(null);
  const modeRef = useRef<"wake" | "command">("wake");
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    if (!enabled || paused) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setState("idle");
      return;
    }

    let cancelled = false;
    let vad: MicVAD | null = null;
    modeRef.current = "wake";

    function handleTranscript(rawText: string) {
      const trimmed = rawText.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();

      if (modeRef.current === "wake") {
        const idx = lower.indexOf(WAKE_WORD);
        if (idx === -1) return; // no wake word in this utterance — stay listening
        const after = trimmed.slice(idx + WAKE_WORD.length).replace(/^[,.\s]+/, "").trim();
        if (after) {
          // "Jarvis, what's my battery" said in one breath — treat as a complete command.
          onCommandRef.current(after);
        } else {
          // Just "Jarvis" — wait for the next utterance to be the actual command.
          modeRef.current = "command";
          setState("command-listening");
        }
      } else {
        modeRef.current = "wake";
        setState("wake-listening");
        onCommandRef.current(trimmed);
      }
    }

    async function start() {
      try {
        setError(null);
        setModelLoadPercent(0);
        const sttPromise = loadLocalStt((p) => {
          if (cancelled) return;
          if ("progress" in p && typeof p.progress === "number") setModelLoadPercent(p.progress);
        });

        const { MicVAD } = await import("@ricky0123/vad-web");
        const instance = await MicVAD.new({
          model: "v5",
          // vad-web locates its own worklet/model assets via document.currentScript.src, a
          // technique that only works for classic <script> tags — under Next.js's ESM bundling
          // there is no currentScript, so it silently falls back to fetching from "/" (this
          // app's own origin) and 404s. Point both asset paths at CDN builds matching the
          // installed versions instead, the same one-time-fetch-then-cache pattern already used
          // for the local TTS model.
          baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",
          onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",
          onSpeechEnd: async (audio: Float32Array) => {
            if (cancelled) return;
            try {
              const transcriber = await sttPromise;
              const text = await transcribeAudio(transcriber, audio);
              if (!cancelled) handleTranscript(text);
            } catch {
              // A single failed transcription shouldn't kill the session — stay listening.
            }
          },
        });
        if (cancelled) {
          instance.destroy();
          return;
        }
        vad = instance;
        setModelLoadPercent(null);
        setState("wake-listening");
        instance.start();
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || "Microphone access was denied.");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      modeRef.current = "wake";
      if (vad) vad.destroy();
    };
  }, [enabled, paused]);

  return { state, error, modelLoadPercent };
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/`[^`]*`/g, "")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type TtsStatus = "idle" | "loading-model" | "generating" | "speaking";
export type VoiceEngine = "local" | "groq";

async function synthesizeSpeechCloud(text: string): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `TTS request failed (${res.status})`);
  }
  return res.blob();
}

/**
 * Speaks text via either a local neural TTS model (Kokoro-82M, running 100% on-device through
 * ONNX/WASM — the browser fetches the model weights once and caches them; every generation
 * after that is fully offline) or, when `engine: "groq"` is passed to speak(), Groq's cloud
 * Orpheus TTS (faster, more natural, but the text leaves the machine per request).
 */
export function useSpeak() {
  const [status, setStatus] = useState<TtsStatus>("idle");
  const [modelLoadPercent, setModelLoadPercent] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  // Guards against playing a stale result if speak() is called again before the previous
  // generation resolves — neither backend exposes a way to abort in-flight generation.
  const generationRef = useRef(0);

  const releaseCurrentAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1; // invalidate any in-flight generation
    releaseCurrentAudio();
    setStatus("idle");
  }, [releaseCurrentAudio]);

  const speak = useCallback(
    async (text: string, engine: VoiceEngine = "local") => {
      const cleaned = cleanForSpeech(text);
      if (!cleaned) return;

      const myGeneration = ++generationRef.current;
      releaseCurrentAudio();

      try {
        let blob: Blob;
        if (engine === "groq") {
          setStatus("generating");
          setModelLoadPercent(null);
          blob = await synthesizeSpeechCloud(cleaned);
        } else {
          setStatus("loading-model");
          setModelLoadPercent(null);
          const tts = await loadLocalTts((p) => {
            if (myGeneration !== generationRef.current) return;
            if ("progress" in p && typeof p.progress === "number") setModelLoadPercent(p.progress);
          });
          if (myGeneration !== generationRef.current) return; // superseded while loading

          setStatus("generating");
          setModelLoadPercent(null);
          blob = await synthesizeSpeech(tts, cleaned);
        }
        if (myGeneration !== generationRef.current) return; // superseded while generating

        const url = URL.createObjectURL(blob);
        currentUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (myGeneration === generationRef.current) setStatus("idle");
        };
        audio.onerror = () => {
          if (myGeneration === generationRef.current) setStatus("idle");
        };
        setStatus("speaking");
        await audio.play();
      } catch {
        if (myGeneration === generationRef.current) setStatus("idle");
      }
    },
    [releaseCurrentAudio]
  );

  useEffect(() => stop, [stop]);

  return { speak, status, speaking: status === "speaking", modelLoadPercent, stop };
}
