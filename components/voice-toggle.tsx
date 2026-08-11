"use client";

import type { VoiceState } from "@/lib/use-speech";
import type { TtsStatus } from "@/lib/use-speech";
import { AiOrb, type OrbState } from "@/components/ai-orb";

function label(state: VoiceState, ttsStatus: TtsStatus, modelLoadPercent: number | null): string {
  if (ttsStatus === "loading-model") {
    return modelLoadPercent !== null ? `Loading voice… ${Math.round(modelLoadPercent)}%` : "Loading voice…";
  }
  if (ttsStatus === "generating") return "Preparing reply…";
  if (ttsStatus === "speaking") return "Speaking…";
  if (state === "wake-listening") return 'Say "Jarvis"…';
  if (state === "command-listening") return "Listening…";
  return "Voice off";
}

function toOrbState(voiceState: VoiceState, ttsStatus: TtsStatus): OrbState {
  if (ttsStatus === "speaking") return "speaking";
  if (ttsStatus === "loading-model" || ttsStatus === "generating") return "thinking";
  if (voiceState === "command-listening") return "listening";
  return "idle";
}

export function VoiceToggle({
  enabled,
  state,
  ttsStatus,
  modelLoadPercent,
  error,
  onToggle,
}: {
  enabled: boolean;
  state: VoiceState;
  ttsStatus: TtsStatus;
  modelLoadPercent: number | null;
  error: string | null;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={enabled ? "Turn voice off" : "Turn voice on"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          enabled
            ? "border-amber-400/40 bg-amber-500/10"
            : "border-white/10 bg-white/5 hover:bg-white/10"
        }`}
      >
        {enabled ? (
          <AiOrb state={toOrbState(state, ttsStatus)} size={26} />
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-zinc-400">
            <rect x="6" y="1.5" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
      {enabled && (
        <span className="hidden text-xs text-zinc-500 sm:inline">
          {label(state, ttsStatus, modelLoadPercent)}
        </span>
      )}
      {error && <span className="hidden text-xs text-red-300 sm:inline">{error}</span>}
    </div>
  );
}
