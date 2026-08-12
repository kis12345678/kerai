import { generateText } from "ai";
import { ollama } from "@/lib/ollama";
import { getCloudProvider } from "@/lib/cloud-providers";
import { DEFAULT_MODEL, findModel, type ModelOption } from "@/lib/models";
import { checkVoiceSatelliteSecret, isVoiceSatelliteConfigured } from "@/lib/voice-satellite-auth";
import { loadServerStt, transcribeServerAudio } from "@/lib/server-stt";
import { loadServerTts, synthesizeServerSpeech } from "@/lib/server-tts";

export const maxDuration = 120;

const VOICE_SYSTEM_PROMPT = `You are Kerai AI, answering out loud through a physical voice speaker — every word you output gets read aloud by a text-to-speech engine, so answer in plain spoken sentences. Never use markdown, bullet points, headings, code blocks, or asterisks; spell out anything that would normally be formatting. Keep replies short and conversational, the way you'd actually talk — a sentence or two unless the user clearly asked for something longer. You have no tools here: you can't read/write files, run commands, or browse the web from this device. If a request needs one of those, say so briefly and suggest they ask via the Kerai AI chat panel instead.`;

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/`[^`]*`/g, "")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function checkAuth(req: Request): boolean {
  if (!isVoiceSatelliteConfigured()) return false;
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return false;
  return checkVoiceSatelliteSecret(match[1]);
}

function resolveModel(requestedId: string | null) {
  const option: ModelOption = (requestedId ? findModel(requestedId) : undefined) ?? findModel(DEFAULT_MODEL)!;
  if (option.provider === "ollama") {
    return ollama.chatModel(option.providerModelId);
  }
  const cloudProvider = getCloudProvider(option.provider);
  if (!cloudProvider) {
    return ollama.chatModel(findModel(DEFAULT_MODEL)!.providerModelId);
  }
  return cloudProvider.chatModel(option.providerModelId);
}

// PCM16LE mono 16kHz, no header — what the firmware records and sends as-is.
function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const pcm16 = new Int16Array(buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
  return float32;
}

async function speakReply(text: string): Promise<Response> {
  const tts = await loadServerTts();
  const wav = await synthesizeServerSpeech(tts, cleanForSpeech(text) || text);
  return new Response(wav, {
    headers: {
      "Content-Type": "audio/wav",
      "X-Reply-Text": encodeURIComponent(text),
    },
  });
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json({ status: "ok", model: DEFAULT_MODEL });
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });

  const body = await req.arrayBuffer();
  if (body.byteLength < 3200) {
    // Under ~0.1s of 16kHz audio — not enough to contain real speech, don't bother round-tripping
    // it through Whisper/the model just to say "I didn't catch that."
    return new Response("Audio too short", { status: 400 });
  }

  const audio = pcm16ToFloat32(body);
  const transcriber = await loadServerStt();
  const transcript = await transcribeServerAudio(transcriber, audio);

  if (!transcript) {
    return speakReply("Sorry, I didn't catch that.");
  }

  const model = resolveModel(req.headers.get("x-model"));
  const { text: replyText } = await generateText({
    model,
    system: VOICE_SYSTEM_PROMPT,
    prompt: transcript,
  });

  const response = await speakReply(replyText);
  response.headers.set("X-Transcript", encodeURIComponent(transcript));
  return response;
}
