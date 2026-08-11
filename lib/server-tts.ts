import { KokoroTTS } from "kokoro-js";

// Same model as lib/local-tts.ts (the browser version) — kept as a separate module since this
// one runs on Node (device: "cpu") and must never end up in a client bundle. Sharing a single
// @huggingface/transformers install between this and lib/server-stt.ts matters: kokoro-js and
// the top-level package must resolve to the SAME onnxruntime-node native binary or loading both
// pipelines in one process segfaults (verified — see package.json's pinned version).
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";

let ttsPromise: Promise<KokoroTTS> | null = null;

export function loadServerTts(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "cpu",
    }).catch((err) => {
      ttsPromise = null;
      throw err;
    });
  }
  return ttsPromise;
}

export async function synthesizeServerSpeech(tts: KokoroTTS, text: string): Promise<ArrayBuffer> {
  const audio = await tts.generate(text, { voice: VOICE });
  return audio.toWav();
}
