// ElevenLabs TTS — the human, in-character voices for each agent.
//
// Uses stable premade voice IDs so no library/voices_read permission is needed (the app's key is
// TTS-scoped). eleven_turbo_v2_5 is the low-latency model, which matters for a spoken assistant.

const KEY = process.env.ELEVENLABS_API_KEY?.trim();
// eleven_multilingual_v2 is the more natural, expressive model and speaks ~29 languages including
// Hindi, Tamil, and other Indian languages — auto-detected from the text, no language flag needed.
// Override with OMNIAI_ELEVENLABS_MODEL (e.g. eleven_turbo_v2_5 for lower latency).
const MODEL = process.env.OMNIAI_ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2";

export function isElevenLabsConfigured(): boolean {
  return Boolean(KEY);
}

export async function synthesizeElevenLabs(text: string, voiceId: string): Promise<Buffer> {
  if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      // Lower stability + a touch of style reads as more human and expressive; speaker boost
      // adds presence. similarity keeps it on-voice.
      voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
