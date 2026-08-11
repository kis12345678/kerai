"use client";

import { pipeline } from "@huggingface/transformers";
import type { ProgressInfo } from "@huggingface/transformers";

// whisper-base.en's "q8" ONNX export has a broken quantization scale on the decoder's embedding
// layer (ORT throws "Missing required scale ... weight_transposed_DequantizeLinear" the moment
// the model tries to load) — a compatibility issue with that specific model+dtype combination,
// not something fixable from this app's code. Xenova/whisper-tiny.en at fp32 is the exact
// model/config the Transformers.js README itself demonstrates and is far more widely used, so
// it's the safer default; swap here if you want base.en's better accuracy and it works for you.
const MODEL_ID = "Xenova/whisper-tiny.en";

export type SttLoadProgress = ProgressInfo;

// Cached at module scope for the same reason as local-tts.ts's model cache — the ONNX weights
// download once from the HF CDN and are reused for every transcription after that.
let sttPromise: ReturnType<typeof loadPipeline> | null = null;

function loadPipeline(onProgress?: (p: SttLoadProgress) => void) {
  return pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: "fp32",
    device: "wasm",
    progress_callback: onProgress,
  });
}

export type SttPipeline = Awaited<ReturnType<typeof loadPipeline>>;

export function loadLocalStt(onProgress?: (p: SttLoadProgress) => void): Promise<SttPipeline> {
  if (!sttPromise) {
    sttPromise = loadPipeline(onProgress).catch((err) => {
      sttPromise = null; // allow retry on next call instead of caching a permanent rejection
      throw err;
    });
  }
  return sttPromise;
}

// Audio must be a mono Float32Array at 16kHz — exactly what @ricky0123/vad-web's onSpeechEnd
// callback provides, so no resampling glue is needed between VAD and Whisper.
export async function transcribeAudio(transcriber: SttPipeline, audio: Float32Array): Promise<string> {
  const result = await transcriber(audio);
  const text = Array.isArray(result) ? result.map((r) => r.text).join(" ") : result.text;
  return text.trim();
}
