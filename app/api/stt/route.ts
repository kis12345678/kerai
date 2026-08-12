// Multilingual speech-to-text via Groq's whisper-large-v3 — understands ~90 languages including
// Hindi, Gujarati, Tamil, Bengali, Marathi, Telugu, and the rest, auto-detecting the language.
//
// The client posts recorded audio (any common format) as multipart form-data; we forward it to
// Groq and return the transcript plus the detected language. This replaces the English-only local
// Whisper for voice input, so the assistant can hear Indian languages.

export const maxDuration = 60;

const GROQ_KEY = process.env.GROQ_API_KEY?.trim();

// Groq picks the decoder from the filename's extension, so the upload has to keep its real one —
// labelling the phone's AAC/MP4 recording "audio.webm" makes it reject the file outright. Browsers
// send a named File; the Android client sends a bare blob, so fall back to its MIME type.
const EXT_BY_MIME: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/webm": "webm",
};

function uploadFilename(file: Blob): string {
  const name = file instanceof File ? file.name : "";
  if (/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i.test(name)) return name;
  const type = file.type.split(";")[0].trim().toLowerCase();
  return `audio.${EXT_BY_MIME[type] ?? "webm"}`;
}

export async function POST(req: Request) {
  if (!GROQ_KEY) {
    return Response.json({ error: "GROQ_API_KEY is not set" }, { status: 500 });
  }

  const inForm = await req.formData().catch(() => null);
  const file = inForm?.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "multipart form-data with a 'file' audio blob is required" }, { status: 400 });
  }
  const language = inForm?.get("language");

  const form = new FormData();
  form.append("file", file, uploadFilename(file));
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json"); // includes detected language
  if (typeof language === "string" && language.trim()) form.append("language", language.trim());

  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json({ error: `Groq STT ${res.status}: ${detail.slice(0, 200)}` }, { status: 502 });
    }
    const data = (await res.json()) as { text?: string; language?: string };
    return Response.json({ text: (data.text ?? "").trim(), language: data.language ?? null });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
