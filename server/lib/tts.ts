import { GoogleGenAI } from "@google/genai";
import type { WraithPersona, VoiceStyle } from "@shared/api";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("[wraith] ⚠ GEMINI_API_KEY not set — TTS will fall back to browser speech synthesis.");
}

// ── Voice Style Mappings ────────────────────────────────────────
// Each style maps to a Gemini TTS voice + optional style prompt prefix

interface VoiceConfig {
  voice: string;
  stylePrompt: string;
}

const VOICE_MAP: Record<WraithPersona, Record<VoiceStyle, VoiceConfig>> = {
  female: {
    warm:      { voice: "Kore",        stylePrompt: "Say in a warm, friendly, and comforting way:" },
    energetic: { voice: "Zephyr",      stylePrompt: "Say in an upbeat, energetic, and enthusiastic way:" },
    calm:      { voice: "Aoede",       stylePrompt: "Say in a calm, relaxed, and gentle way:" },
    whisper:   { voice: "Callirrhoe",  stylePrompt: "Say in a soft, intimate whisper:" },
  },
  male: {
    warm:      { voice: "Puck",        stylePrompt: "Say in a warm, friendly, and laid-back way:" },
    energetic: { voice: "Enceladus",   stylePrompt: "Say in an upbeat, energetic, and excited way:" },
    calm:      { voice: "Charon",      stylePrompt: "Say in a calm, steady, and composed way:" },
    whisper:   { voice: "Fenrir",      stylePrompt: "Say in a soft, quiet whisper:" },
  },
};

function getVoiceConfig(persona: WraithPersona, style: VoiceStyle): VoiceConfig {
  return VOICE_MAP[persona][style] ?? VOICE_MAP[persona].warm;
}

/**
 * Generate speech audio from text using Gemini TTS.
 * Returns raw PCM audio data (16-bit, 24kHz, mono).
 */
export async function generateSpeech(
  text: string,
  persona: WraithPersona = "female",
  voiceStyle: VoiceStyle = "warm",
): Promise<Buffer | null> {
  if (!GEMINI_API_KEY) return null;

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  try {
    const { voice, stylePrompt } = getVoiceConfig(persona, voiceStyle);
    // Strip emojis for cleaner speech
    const cleanText = text.replace(/[\u{1F600}-\u{1F9FF}]/gu, "").trim();
    if (!cleanText) return null;

    // Prepend style prompt to guide the TTS delivery
    const styledText = `${stylePrompt} ${cleanText}`;

    const interaction = await client.interactions.create({
      model: "gemini-2.5-flash-preview-tts",
      input: styledText,
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [{ voice }],
      },
    });

    if (!interaction.output_audio?.data) return null;

    return Buffer.from(interaction.output_audio.data, "base64");
  } catch (err) {
    console.error("[tts] Gemini TTS error:", err);
    return null;
  }
}
