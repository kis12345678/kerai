import type { UIMessage } from "ai";

// Rough proxy for tokens (~4 chars/token is a common heuristic) — good enough to catch runaway
// growth without needing a real tokenizer. Generous relative to local models' context windows
// (most configured here run 32k+ tokens) since the system prompt, tool schemas, and the
// model's own response still need headroom within that window.
const MAX_HISTORY_CHARS = 120_000;
// Always keep at least this many of the most recent messages, even if they alone exceed the
// budget — trimming should never remove the message the user is actively responding to.
const MIN_KEPT_MESSAGES = 6;

function estimatePartSize(part: UIMessage["parts"][number]): number {
  if ("text" in part && typeof part.text === "string") return part.text.length;
  try {
    return JSON.stringify(part).length;
  } catch {
    return 0;
  }
}

function estimateMessageSize(message: UIMessage): number {
  return message.parts.reduce((sum, part) => sum + estimatePartSize(part), 0);
}

/**
 * Drops the oldest messages once total conversation size exceeds a rough character budget, so a
 * long-running chat session doesn't silently blow past the model's context window. Trims whole
 * messages only (never splits one) — a tool call and its result always live inside the same
 * UIMessage's parts array in this SDK's format, so whole-message trimming can't separate them.
 */
export function compactMessages(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= MIN_KEPT_MESSAGES) return messages;

  const totalSize = messages.reduce((sum, m) => sum + estimateMessageSize(m), 0);
  if (totalSize <= MAX_HISTORY_CHARS) return messages;

  const kept: UIMessage[] = [];
  let runningSize = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = estimateMessageSize(messages[i]);
    if (runningSize + size > MAX_HISTORY_CHARS && kept.length >= MIN_KEPT_MESSAGES) break;
    kept.unshift(messages[i]);
    runningSize += size;
  }
  return kept;
}
