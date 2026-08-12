"use client";

import { useEffect, useRef, useState } from "react";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";

// Must match the installed @mediapipe/tasks-vision version so the WASM binary matches the JS
// bindings — jsdelivr serves the package's own /wasm folder, not a separately versioned asset.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
// Google's officially hosted pretrained gesture model — same one used in MediaPipe's own web
// demos. Downloaded once by the browser and cached, same tradeoff as the Whisper/Kokoro weights.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const MIN_SCORE = 0.6;
// Consecutive video frames the same gesture must be held for before it counts as intentional —
// filters out the transitional poses a hand passes through while moving.
const CONFIRM_FRAMES = 5;
// Minimum gap before the same action can fire again, so holding a pose doesn't repeat-fire it.
const COOLDOWN_MS = 1500;

export type GestureAction = "stop" | "toggleMic" | "approve" | "deny";
export type GestureState = "idle" | "loading" | "active" | "error";

const GESTURE_TO_ACTION: Record<string, GestureAction> = {
  Open_Palm: "stop",
  Closed_Fist: "toggleMic",
  Thumb_Up: "approve",
  Thumb_Down: "deny",
};

export const GESTURE_HELP = [
  "✋ Open palm — stop",
  "✊ Fist — toggle mic",
  "👍 Thumbs up — approve",
  "👎 Thumbs down — deny",
].join("  ·  ");

// MediaPipe's WASM runtime pipes everything it prints — including INFO-level lines like
// "Created TensorFlow Lite XNNPACK delegate for CPU." — through console.error, because
// Emscripten maps stderr there. Next's dev overlay then reports a successful initialisation
// as a Console Error.
//
// Only lines whose first argument literally begins with "INFO:" are dropped, so genuine
// MediaPipe failures still reach the console untouched. Ref-counted and restored on cleanup:
// React re-runs effects (twice in dev under Strict Mode), and naive save/restore would leave a
// patched console.error permanently installed.
let infoFilterDepth = 0;
let unpatchedConsoleError: typeof console.error | null = null;

function suppressMediapipeInfoLogs(): () => void {
  if (infoFilterDepth === 0) {
    const base = console.error;
    unpatchedConsoleError = base;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].trimStart().startsWith("INFO:")) return;
      base(...args);
    };
  }
  infoFilterDepth += 1;

  let released = false;
  return () => {
    if (released) return; // cleanup can fire more than once; don't double-decrement
    released = true;
    infoFilterDepth -= 1;
    if (infoFilterDepth === 0 && unpatchedConsoleError) {
      console.error = unpatchedConsoleError;
      unpatchedConsoleError = null;
    }
  };
}

export function useGestureControl({
  enabled,
  onAction,
}: {
  enabled: boolean;
  onAction: (action: GestureAction) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  const rafRef = useRef<number | null>(null);
  const onActionRef = useRef(onAction);
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  const [internalState, setInternalState] = useState<GestureState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [internalLastGesture, setInternalLastGesture] = useState<string | null>(null);

  const streakRef = useRef<{ gesture: string | null; count: number }>({ gesture: null, count: 0 });
  const lastFiredRef = useRef<{ action: GestureAction | null; at: number }>({ action: null, at: 0 });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    // Installed before start() because the INFO line is emitted lazily, on the first
    // recognizeForVideo call rather than at construction.
    const releaseLogFilter = suppressMediapipeInfoLogs();

    async function start() {
      setInternalState("loading");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error("Video element not mounted");
        video.srcObject = stream;
        await video.play();

        const { GestureRecognizer: GR, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        const recognizer = await GR.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
        });
        if (cancelled) {
          // The cleanup already may have closed it via the ref — close is idempotent but
          // MediaPipe can throw on a raced double-close, so never let that escape.
          try {
            recognizer.close();
          } catch {
            // already closed
          }
          return;
        }
        recognizerRef.current = recognizer;
        setInternalState("active");

        const loop = () => {
          const v = videoRef.current;
          const r = recognizerRef.current;
          if (!v || !r || v.readyState < 2) {
            rafRef.current = requestAnimationFrame(loop);
            return;
          }

          const result = r.recognizeForVideo(v, performance.now());
          const top = result.gestures?.[0]?.[0];
          const name = top && top.score >= MIN_SCORE && top.categoryName !== "None" ? top.categoryName : null;
          setInternalLastGesture(name);

          const streak = streakRef.current;
          if (name && name === streak.gesture) {
            streak.count += 1;
          } else {
            streak.gesture = name;
            streak.count = name ? 1 : 0;
          }

          if (name && streak.count >= CONFIRM_FRAMES) {
            const action = GESTURE_TO_ACTION[name];
            if (action) {
              const last = lastFiredRef.current;
              const now = Date.now();
              if (last.action !== action || now - last.at >= COOLDOWN_MS) {
                lastFiredRef.current = { action, at: now };
                onActionRef.current(action);
              }
            }
          }

          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setInternalState("error");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      releaseLogFilter();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try {
        recognizerRef.current?.close();
      } catch {
        // already closed (e.g. by the in-flight start() cancelled branch)
      }
      recognizerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      streakRef.current = { gesture: null, count: 0 };
    };
  }, [enabled]);

  return {
    videoRef,
    state: enabled ? internalState : "idle",
    error,
    lastGesture: enabled ? internalLastGesture : null,
  };
}
