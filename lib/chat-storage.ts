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

export function renameSession(id: string, title: string): void {
  const sessions = readJson<ChatSession[]>(SESSIONS_KEY) ?? [];
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sessions[idx] = { ...sessions[idx], title: title.trim() || sessions[idx].title, updatedAt: Date.now() };
  writeJson(SESSIONS_KEY, sessions);
}

// Render a session as human-readable markdown for export (downloads as a .md file).
function toolLine(part: { type: string; toolCallId: string; input?: Record<string, unknown> }): string {
  const name = part.type.replace(/^tool-/, "");
  const input = part.input ?? {};
  const path = (input.path as string) ?? "";
  const desc =
    name === "runCommand"
      ? `$ ${input.command as string}`
      : name === "writeFile" || name === "editFile"
        ? `${name} ${path}`
        : path
          ? `${name} ${path}`
          : name;
  return `> 🔧 [tool: ${desc}]`;
}

export function sessionToMarkdown(session: ChatSession): string {
  const parts: string[] = [`# ${session.title}`, ""];
  for (const message of session.messages) {
    const role = message.role === "user" ? "You" : "Kerai AI";
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text?: string }).text ?? "")
      .join("\n\n")
      .trim();
    const tools = message.parts
      .filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool")
      .map((p) => toolLine(p as Parameters<typeof toolLine>[0]))
      .join("\n");
    if (!text && !tools) continue;
    parts.push(`**${role}**:${text ? `\n${text}` : ""}${tools ? `\n${tools}` : ""}`, "");
  }
  return parts.join("\n");
}

export function downloadSession(session: ChatSession): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([sessionToMarkdown(session)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = session.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "chat";
  a.href = url;
  a.download = `${safe}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
