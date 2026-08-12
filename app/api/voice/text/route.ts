import { generateText } from "ai";
import { ollama } from "@/lib/ollama";
import { getCloudProvider } from "@/lib/cloud-providers";
import { findModel } from "@/lib/models";
import { authenticateDevice } from "@/lib/android-agent";

export const maxDuration = 120;

const WORKSPACE = process.env.OMNIAI_WORKSPACE?.trim() || process.cwd();

// The native phone app does its own speech-to-text and text-to-speech, so unlike /api/voice/turn
// (which trades audio in and audio out for the firmware satellite) this endpoint is plain text in,
// plain text out. Auth reuses the per-device token from the android-agent channel.
const VOICE_SYSTEM_PROMPT =
  "You are Kerai AI, answering out loud on a phone — every word you return is read aloud by the " +
  "phone's text-to-speech, so reply in plain spoken sentences. Never use markdown, bullets, " +
  "headings, code blocks, or asterisks. Keep it short and conversational, a sentence or two " +
  // See /api/voice/agent: naming the Indian languages here made small models answer everything in
  // Hindi, including English questions. One symmetric rule, no language list, no examples.
  "unless more is clearly needed. Answer in exactly the language the user spoke to you in, and " +
  "never switch or translate: English in, English out; Hindi in, Hindi out. Use their script. " +
  "Say it ONCE, in that one language only — never repeat yourself with a translation, since the " +
  "user would hear the whole answer twice.";

function bearer(req: Request): string | undefined {
  return req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, "")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Fast model by default so spoken replies feel instant; override with OMNIAI_VOICE_MODEL.
const VOICE_MODEL = process.env.OMNIAI_VOICE_MODEL?.trim() || "llama3.1:8b";

function resolveModel(requestedId: string | undefined) {
  if (!requestedId) return ollama.chatModel(VOICE_MODEL);
  const option = findModel(requestedId);
  if (!option) return ollama.chatModel(VOICE_MODEL);
  if (option.provider === "ollama") return ollama.chatModel(option.providerModelId);
  const cloud = getCloudProvider(option.provider);
  return cloud ? cloud.chatModel(option.providerModelId) : ollama.chatModel(VOICE_MODEL);
}

export async function POST(req: Request) {
  const device = await authenticateDevice(WORKSPACE, bearer(req));
  if (!device) {
    return Response.json({ error: "Unauthorized device" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { text?: string; model?: string } | null;
  const text = body?.text?.trim();
  if (!text) {
    return Response.json({ error: "Expected { text }" }, { status: 400 });
  }

  try {
    const { text: reply } = await generateText({
      model: resolveModel(body?.model),
      system: VOICE_SYSTEM_PROMPT,
      prompt: text,
    });
    return Response.json({ reply: cleanForSpeech(reply) || "Sorry, I didn't catch that." });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
