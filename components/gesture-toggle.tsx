"use client";

import { GESTURE_HELP, type GestureState } from "@/lib/use-gesture";

export function GestureToggle({
  enabled,
  onToggle,
  state,
  error,
  lastGesture,
  videoRef,
}: {
  enabled: boolean;
  onToggle: () => void;
  state: GestureState;
  error: string | null;
  lastGesture: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        title={`Gesture control — ${GESTURE_HELP}. Needs a webcam; runs fully in-browser, nothing leaves the machine.`}
        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
          enabled
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-edge bg-surface text-frost/75 hover:bg-edge"
        }`}
      >
        ✋ Gestures{enabled && state === "loading" ? "…" : ""}
      </button>

      {enabled && (
        <div className="relative h-12 w-16 overflow-hidden rounded-lg border border-edge bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
          {lastGesture && (
            <div className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1 text-center text-[9px] leading-tight text-accent">
              {lastGesture}
            </div>
          )}
        </div>
      )}

      {enabled && state === "error" && error && (
        <div className="max-w-[12rem] truncate text-xs text-red-400" title={error}>
          {error}
        </div>
      )}
    </div>
  );
}
