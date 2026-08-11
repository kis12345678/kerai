import { pipeline } from "@huggingface/transformers";
import type { ProgressInfo } from "@huggingface/transformers";

// Same model as lib/local-stt.ts (the browser version) — kept as a separate module rather than
// shared, since this one runs on Node (device: "cpu") and must never end up in a client bundle.
const MODEL_ID = "Xenova/whisper-tiny.en";

export type SttLoadProgress = ProgressInfo;

let sttPromise: ReturnType<typeof loadPipeline> | null = null;

function loadPipeline(onProgress?: (p: SttLoadProgress) => void) {
  return pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: "fp32",
    device: "cpu",
    progress_callback: onProgress,
  });
}

export type ServerSttPipeline = Awaited<ReturnType<typeof loadPipeline>>;

// Cached at module scope — the ONNX weights download once from the HF CDN on first request and
// are reused for every transcription after that, same tradeoff as every other model in this app.
export function loadServerStt(onProgress?: (p: SttLoadProgress) => void): Promise<ServerSttPipeline> {
  if (!sttPromise) {
    sttPromise = loadPipeline(onProgress).catch((err) => {
      sttPromise = null;
      throw err;
    });
  }
  return sttPromise;
}

// Audio must be a mono Float32Array at 16kHz.
export async function transcribeServerAudio(
  transcriber: ServerSttPipeline,
  audio: Float32Array
): Promise<string> {
  const result = await transcriber(audio);
  const text = Array.isArray(result) ? result.map((r) => r.text).join(" ") : result.text;
  return text.trim();
}
