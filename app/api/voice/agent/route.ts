import { generateText, stepCountIs } from "ai";
import { ollama } from "@/lib/ollama";
import { getCloudProvider } from "@/lib/cloud-providers";
import { findModel } from "@/lib/models";
import { authenticateDevice } from "@/lib/android-agent";
import { createPhoneActionTools, PHONE_ACTION_SCHEMAS, type PhoneAction } from "@/lib/phone-actions";
import { AGENTS } from "@/lib/agents";

export const maxDuration = 120;

// The voice the phone should speak this reply in. Returned with every turn so the ElevenLabs voice
// ID lives here rather than being hardcoded in the Android app — the phone just plays back whatever
// voice the server names. Friday's by default: this endpoint's job is doing things on the device,
// which is her remit. Override with OMNIAI_PHONE_VOICE_ID.
const PHONE_VOICE_ID = process.env.OMNIAI_PHONE_VOICE_ID?.trim() || AGENTS.friday.voiceId;

const WORKSPACE = process.env.OMNIAI_WORKSPACE?.trim() || process.cwd();

// The voice "brain". Unlike /api/voice/text (plain chat spoken aloud), this one can decide to
// DO something on the phone: it runs the model with the phone-action tools, collects whichever
// actions the model chose, and returns them alongside a short spoken confirmation. The phone
// executes the actions and speaks the confirmation.
const SYSTEM_PROMPT =
  "You are Kerai, a voice assistant running on the user's Android phone. You hear spoken commands " +
  "and can act on the phone. When the user asks you to DO something — call or message someone, " +
  "open an app, play or pause media, toggle a setting, handle a call, read notifications — call " +
  "the matching tool. If it's just a question, answer it. ALWAYS also give one short spoken " +
  "sentence (no markdown, no lists) confirming what you're doing or answering — it is read aloud. " +
  // Mirror the input language, stated as one symmetric rule. An earlier version listed the Indian
  // languages by name and gave Hindi examples, which read to a small model as "prefer Hindi" — it
  // answered English questions in Hindi every time. Name no languages, give no examples.
  "Answer in exactly the language the user spoke to you in, and never switch or translate: " +
  "English in, English out; Hindi in, Hindi out. Use the same script they used. Say it ONCE, in " +
  "that one language only — never repeat yourself with a translation, since every word you " +
  "return is spoken aloud and the user would hear the whole answer twice.";

function bearer(req: Request): string | undefined {
  return req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
}

function cleanForSpeech(text: string): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, "")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Small models often restate themselves ("Paris. The capital of France is Paris."), which is
  // read aloud as an annoying echo. Drop back-to-back duplicate sentences.
  const sentences = stripped.match(/[^.!?]+[.!?]*/g) ?? [stripped];
  const kept: string[] = [];
  for (const s of sentences) {
    const norm = s.trim().toLowerCase();
    if (norm && norm !== kept[kept.length - 1]?.trim().toLowerCase()) kept.push(s.trim());
  }
  return kept.join(" ").trim();
}

// Voice must feel instant, so it defaults to a fast, tool-capable model rather than the
// workspace default (which is a slow reasoning model — fine for the codebase agent, unusable for
// a spoken assistant). Override with OMNIAI_VOICE_MODEL.
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
  if (!device) return Response.json({ error: "Unauthorized device" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { text?: string; model?: string } | null;
  const text = body?.text?.trim();
  if (!text) return Response.json({ error: "Expected { text }" }, { status: 400 });

  try {
    const result = await generateText({
      model: resolveModel(body?.model),
      system: SYSTEM_PROMPT,
      prompt: text,
      tools: createPhoneActionTools(),
      // A couple of steps so the model can act and then speak its confirmation.
      stopWhen: stepCountIs(3),
    });

    // Collect the actions, then re-validate each against its own schema. Small tool-calling
    // models occasionally emit invalid enum values (e.g. action:"skipNext") or duplicate a call,
    // and those would silently fail on the phone — so drop anything that doesn't parse, and
    // de-duplicate, leaving the phone only clean, runnable actions.
    const seen = new Set<string>();
    const actions: PhoneAction[] = [];
    for (const call of result.steps.flatMap((step) => step.toolCalls)) {
      const schema = PHONE_ACTION_SCHEMAS[call.toolName as keyof typeof PHONE_ACTION_SCHEMAS];
      const parsed = schema?.safeParse(call.input ?? {});
      if (!parsed?.success) continue;
      const args = parsed.data as Record<string, unknown>;
      const key = `${call.toolName}:${JSON.stringify(args)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({ name: call.toolName, args });
    }

    const reply =
      cleanForSpeech(result.text) ||
      (actions.length ? "Done." : "Sorry, I didn't catch that.");

    return Response.json({ reply, actions, voiceId: PHONE_VOICE_ID });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
