import type { UIMessage } from "ai";

export type ChatSession = {
  id: string;
  title: string;
  messages: UIMessage[];
  updatedAt: number;
};

export type VoiceEngine = "local" | "groq";
export type SttEngine = "local" | "browser";

export type ChatSettings = {
  model: string;
  workspace: string;
  voiceEngine?: VoiceEngine; // absent on settings saved before this existed — treat as "local"
  sttEngine?: SttEngine; // absent on settings saved before this existed — treat as "local"
};

const SESSIONS_KEY = "omniai:sessions";
const SETTINGS_KEY = "omniai:settings";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable — persistence is best-effort
  }
}

export function loadSessions(): ChatSession[] {
  const sessions = readJson<ChatSession[]>(SESSIONS_KEY) ?? [];
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveSession(session: ChatSession): void {
  const sessions = readJson<ChatSession[]>(SESSIONS_KEY) ?? [];
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  else sessions.push(session);
  writeJson(SESSIONS_KEY, sessions);
}

export function deleteSession(id: string): void {
  const sessions = readJson<ChatSession[]>(SESSIONS_KEY) ?? [];
  writeJson(
    SESSIONS_KEY,
    sessions.filter((s) => s.id !== id)
  );
}

export function deriveTitle(messages: UIMessage[]): string {
  const firstUserText = messages
    .find((m) => m.role === "user")
    ?.parts.find((p) => p.type === "text")?.text;
  if (!firstUserText) return "New chat";
  const trimmed = firstUserText.trim().replace(/\s+/g, " ");
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}

export function loadSettings(): ChatSettings | null {
  return readJson<ChatSettings>(SETTINGS_KEY);
}

export function saveSettings(settings: ChatSettings): void {
  writeJson(SETTINGS_KEY, settings);
}
