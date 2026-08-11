"use client";

import { KokoroTTS } from "kokoro-js";
import type { ProgressInfo } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart"; // highest-graded default voice per the model card

export type TtsLoadProgress = ProgressInfo;

// Model download+init is expensive (tens of MB of ONNX weights, fetched once from the HF CDN
// and cached by the browser after) — cache the promise at module scope so every useSpeak()
// mount/call shares one instance instead of re-downloading and re-initializing per component.
let ttsPromise: Promise<KokoroTTS> | null = null;

export function loadLocalTts(onProgress?: (p: TtsLoadProgress) => void): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: onProgress,
    }).catch((err) => {
      ttsPromise = null; // allow retry on next call instead of caching a permanent rejection
      throw err;
    });
  }
  return ttsPromise;
}

export async function synthesizeSpeech(tts: KokoroTTS, text: string): Promise<Blob> {
  const audio = await tts.generate(text, { voice: VOICE });
  return audio.toBlob();
}
