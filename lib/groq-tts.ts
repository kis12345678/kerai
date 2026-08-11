import Groq from "groq-sdk";

const MODEL = "canopylabs/orpheus-v1-english";
const VOICE = "hannah";

export function isGroqTtsConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export async function synthesizeSpeechGroq(text: string): Promise<ArrayBuffer> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set on the server");

  const groq = new Groq({ apiKey });
  const response = await groq.audio.speech.create({
    model: MODEL,
    voice: VOICE,
    input: text,
    response_format: "wav",
  });
  return response.arrayBuffer();
}
