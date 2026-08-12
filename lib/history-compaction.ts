import type { UIMessage } from "ai";

// Keeps a long conversation inside the model's context window.
//
// This used to simply delete the oldest messages once the total passed the budget. That kept the
// request valid and lost the conversation: ask about something decided forty messages ago and the
// model had no idea it had ever been discussed, with nothing to indicate anything was missing. For
// a system meant to have memory, silently forgetting is the wrong failure — being told "this was
// discussed, here's the gist" is far more useful than an unexplained blank.
//
// So the dropped span is condensed into a single message instead of discarded. The condensing is
// deliberately deterministic rather than a model call: this runs on the critical path of every
// long turn, the default model here is local and slow, and a summarizer that can hang or error
// would make the app worse in exactly the situation it's meant to help. An extractive digest is
// cheaper and cannot fail. Swapping in a model-written summary is a contained change — replace
// summarizeDropped and make compactMessages async — if the quality is ever worth the latency.

// Rough proxy for tokens (~4 chars/token is a common heuristic) — good enough to catch runaway
// growth without needing a real tokenizer. Generous relative to local models' context windows
// (most configured here run 32k+ tokens) since the system prompt, tool schemas, and the
// model's own response still need headroom within that window.
const MAX_HISTORY_CHARS = 120_000;
// Always keep at least this many of the most recent messages, even if they alone exceed the
// budget — trimming should never remove the message the user is actively responding to.
const MIN_KEPT_MESSAGES = 6;
// The digest is itself part of the history, so it gets its own slice of the budget rather than
// being added on top of a already-full window.
const DIGEST_MAX_CHARS = 4_000;
// How much of any single dropped message survives into the digest.
const DIGEST_LINE_CHARS = 200;

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

function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * One line per dropped message: who said it, the gist of what they said, and which tools ran.
 *
 * Tool calls are recorded by name rather than payload on purpose — that a commit was made or a
 * file written is the part worth remembering; the exact arguments are not, and they are what make
 * tool parts enormous in the first place.
 */
function summarizeMessage(message: UIMessage): string | null {
  const texts: string[] = [];
  const toolNames: string[] = [];

  for (const part of message.parts) {
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      texts.push(part.text);
    } else if (part.type === "dynamic-tool") {
      toolNames.push((part as { toolName?: string }).toolName ?? "tool");
    } else if (part.type.startsWith("tool-")) {
      toolNames.push(part.type.slice("tool-".length));
    }
  }

  const who = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
  const said = texts.length > 0 ? clamp(texts.join(" "), DIGEST_LINE_CHARS) : "";
  const did = toolNames.length > 0 ? `[used: ${[...new Set(toolNames)].join(", ")}]` : "";

  if (!said && !did) return null;
  return `${who}: ${[said, did].filter(Boolean).join(" ")}`;
}

/**
 * Builds the digest, keeping the start and the end of the dropped span when it doesn't all fit.
 *
 * Middle-out rather than oldest-first or newest-first: the beginning of a conversation usually
 * holds the original task and the constraints, and the most recent dropped messages are the ones
 * the current turn is most likely to refer back to. The middle is what's safe to lose.
 */
function summarizeDropped(dropped: readonly UIMessage[]): string {
  const lines = dropped.map(summarizeMessage).filter((line): line is string => line !== null);
  if (lines.length === 0) return "";

  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  let i = 0;
  let j = lines.length - 1;
  // Alternate front and back so both ends grow together until the budget runs out.
  let takeFromHead = true;

  while (i <= j) {
    const line = takeFromHead ? lines[i] : lines[j];
    if (used + line.length > DIGEST_MAX_CHARS) break;
    used += line.length;
    if (takeFromHead) {
      head.push(line);
      i += 1;
    } else {
      tail.unshift(line);
      j -= 1;
    }
    takeFromHead = !takeFromHead;
  }

  const omitted = j - i + 1;
  const middle = omitted > 0 ? [`… (${omitted} further message${omitted === 1 ? "" : "s"} omitted) …`] : [];

  return [...head, ...middle, ...tail].join("\n");
}

function digestMessage(dropped: readonly UIMessage[]): UIMessage | null {
  const summary = summarizeDropped(dropped);
  if (!summary) return null;

  return {
    id: `compaction-digest-${dropped.length}`,
    // Not `system`: the SDK warns against system messages outside the system prompt, and several
    // providers reject one that isn't the first message. A labelled user message is understood
    // everywhere and reads unambiguously to the model.
    role: "user",
    parts: [
      {
        type: "text",
        text: `[Earlier in this conversation — condensed to stay within the context window. ${dropped.length} message${
          dropped.length === 1 ? "" : "s"
        } summarized; wording is abbreviated, not verbatim.]\n\n${summary}`,
      },
    ],
  };
}

/**
 * Trims a conversation to fit the context budget, replacing what it removes with a digest.
 *
 * Trims whole messages only (never splits one) — a tool call and its result always live inside the
 * same UIMessage's parts array in this SDK's format, so whole-message trimming can't separate them.
 */
export function compactMessages(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= MIN_KEPT_MESSAGES) return messages;

  const totalSize = messages.reduce((sum, m) => sum + estimateMessageSize(m), 0);
  if (totalSize <= MAX_HISTORY_CHARS) return messages;

  // The digest occupies part of the window, so the verbatim tail gets the remainder.
  const verbatimBudget = MAX_HISTORY_CHARS - DIGEST_MAX_CHARS;

  const kept: UIMessage[] = [];
  let runningSize = 0;
  let firstKept = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const size = estimateMessageSize(messages[i]);
    if (runningSize + size > verbatimBudget && kept.length >= MIN_KEPT_MESSAGES) break;
    kept.unshift(messages[i]);
    runningSize += size;
    firstKept = i;
  }

  const dropped = messages.slice(0, firstKept);
  if (dropped.length === 0) return kept;

  const digest = digestMessage(dropped);
  return digest ? [digest, ...kept] : kept;
}
