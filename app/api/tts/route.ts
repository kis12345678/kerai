import { isGroqTtsConfigured, synthesizeSpeechGroq } from "@/lib/groq-tts";

export async function GET() {
  return Response.json({ available: isGroqTtsConfigured() });
}

export async function POST(req: Request) {
  if (!isGroqTtsConfigured()) {
    return Response.json({ error: "GROQ_API_KEY is not set on the server" }, { status: 500 });
  }

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || !text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const audio = await synthesizeSpeechGroq(text);
    return new Response(audio, { headers: { "Content-Type": "audio/wav" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
