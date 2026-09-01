import { RequestHandler } from "express";
import { generateSpeech } from "../lib/tts.js";
import type { WraithPersona, VoiceStyle } from "@shared/api";

/**
 * POST /api/tts — Generate speech audio from text.
 * Body: { text: string, persona?: "female" | "male", voiceStyle?: VoiceStyle }
 * Returns: audio/wav binary
 */
export const handleTTS: RequestHandler = async (req, res) => {
  const { text, persona = "female", voiceStyle = "warm" } = req.body as {
    text?: string;
    persona?: WraithPersona;
    voiceStyle?: VoiceStyle;
  };

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Text is required" });
    return;
  }

  const audioBuffer = await generateSpeech(text.trim(), persona, voiceStyle);

  if (!audioBuffer) {
    // Fall back to 204 No Content — client will use browser TTS
    res.status(204).end();
    return;
  }

  // Return raw PCM as audio/wav (24kHz, 16-bit, mono)
  // Wrap in a proper WAV header
  const wavBuffer = pcmToWav(audioBuffer, 24000, 1, 2);

  res.set({
    "Content-Type": "audio/wav",
    "Content-Length": wavBuffer.length.toString(),
    "Cache-Control": "public, max-age=3600",
  });
  res.status(200).send(wavBuffer);
};

/**
 * Convert raw PCM data to a WAV file buffer.
 */
function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  numChannels: number,
  sampleWidth: number,
): Buffer {
  const dataLength = pcm.length;
  const headerLength = 44;
  const buffer = Buffer.alloc(headerLength + dataLength);

  // "RIFF" chunk descriptor
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);

  // "fmt " sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // sub-chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * sampleWidth, 28); // byte rate
  buffer.writeUInt16LE(numChannels * sampleWidth, 32); // block align
  buffer.writeUInt16LE(sampleWidth * 8, 34); // bits per sample

  // "data" sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  pcm.copy(buffer, 44);

  return buffer;
}
