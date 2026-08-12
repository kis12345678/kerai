import { isGroqTtsConfigured, synthesizeSpeechGroq } from "@/lib/groq-tts";
import { isElevenLabsConfigured, synthesizeElevenLabs } from "@/lib/elevenlabs-tts";

export async function GET() {
  // Report both backends so the client knows a human voice is available.
  return Response.json({
    available: isElevenLabsConfigured() || isGroqTtsConfigured(),
    elevenlabs: isElevenLabsConfigured(),
    groq: isGroqTtsConfigured(),
  });
}

export async function POST(req: Request) {
  const { text, voiceId } = (await req.json().catch(() => ({}))) as { text?: string; voiceId?: string };
  if (!text || !text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  // Prefer ElevenLabs (human, per-agent voices) when a voice is requested and it's configured;
  // fall back to Groq otherwise.
  if (voiceId && isElevenLabsConfigured()) {
    try {
      const audio = await synthesizeElevenLabs(text, voiceId);
      return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg" } });
    } catch (err) {
      // Fall through to Groq rather than failing the turn.
      if (!isGroqTtsConfigured()) {
        return Response.json({ error: (err as Error).message }, { status: 502 });
      }
    }
  }

  if (!isGroqTtsConfigured()) {
    return Response.json({ error: "No TTS backend configured (set ELEVENLABS_API_KEY or GROQ_API_KEY)" }, { status: 500 });
  }
  try {
    const audio = await synthesizeSpeechGroq(text);
    return new Response(audio, { headers: { "Content-Type": "audio/wav" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
