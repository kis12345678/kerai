// An append-only record of everything the assistant actually did to the machine.
//
// The approval gate (lib/tool-risk.ts) decides whether an action may happen and the critic
// (lib/critic.ts) decides whether it worked, but until now neither left a trace. Once an agent has
// this much reach — a shell, the filesystem, the desktop, a paired phone — "what did it do, what
// was it allowed to do, and who said yes" has to be answerable after the fact, not reconstructed
// from a chat log the user can edit or delete.
//
// Written as JSON Lines to .omniai/audit.jsonl in the workspace, next to the other state this app
// owns. One self-contained JSON object per line: appendable without parsing what's already there,
// greppable, and readable by anything.
//
// Nothing here may break a turn. Every write is best-effort and swallowed on failure — an audit
// log that can take down the assistant is a worse liability than a gap in the log.

import { promises as fs } from "node:fs";
import path from "node:path";

const AUDIT_DIR = ".omniai";
const AUDIT_FILE = "audit.jsonl";

/** Above this the log is trimmed to the most recent entries, so it can't grow without bound. */
const MAX_BYTES = 5_000_000;
/** How much of the tail survives a trim. */
const KEEP_BYTES = 2_000_000;

/** Cap on any single recorded field, so a huge file write or command can't bloat the log. */
const MAX_FIELD_CHARS = 300;

export type AuditRecord =
  | {
      kind: "tool";
      at: string;
      agent: string;
      tool: string;
      /** The argument that identifies what was acted on — a path, a command, a URL. */
      target: string;
      /** Whether this tool needed the user's explicit go-ahead to run at all. */
      gated: boolean;
      outcome: "success" | "error" | "denied";
      detail?: string;
    }
  | {
      kind: "verification";
      at: string;
      agent: string;
      request: string;
      ok: boolean;
      tier: string;
      reason?: string;
    };

function clamp(value: string, max = MAX_FIELD_CHARS): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * The argument worth recording for a given tool.
 *
 * Named fields in preference order rather than the whole input on purpose: writeFile's input
 * carries the entire file body, androidTypeText carries whatever was typed, and neither belongs in
 * a log that persists. Recording the path or the target and dropping the payload keeps the trail
 * useful without turning it into a second copy of the user's data.
 */
// Deliberately excludes `text`. androidTypeText and writeClipboard both carry their payload there,
// and that payload is routinely a password, a message, or something else the user would not expect
// this app to write to disk. Those calls fall through to the key-name fallback below, which records
// that text was typed without recording what it was.
const TARGET_FIELDS = [
  "path",
  "command",
  "url",
  "app",
  "panel",
  "action",
  "message",
  "query",
  "remotePath",
  "localPath",
  "package",
  "serial",
] as const;

export function describeTarget(input: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const field of TARGET_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      parts.push(clamp(value));
      break;
    }
  }

  // Withheld content is still worth recording the shape of: "typed 24 characters into device X"
  // is a useful audit line, where the serial alone says nothing about what happened.
  const text = input.text;
  if (typeof text === "string") {
    parts.push(`${text.length} chars (content not logged)`);
  }

  if (parts.length > 0) return parts.join(" · ");

  const keys = Object.keys(input);
  return keys.length > 0 ? clamp(`(${keys.join(", ")})`) : "—";
}

function auditPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, AUDIT_DIR, AUDIT_FILE);
}

/**
 * Trims the log to its most recent entries once it exceeds the cap, cutting at a line boundary so
 * the file stays valid JSON Lines.
 */
async function trimIfOversized(file: string): Promise<void> {
  let size: number;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    return; // no log yet
  }
  if (size <= MAX_BYTES) return;

  const contents = await fs.readFile(file, "utf8");
  const tail = contents.slice(-KEEP_BYTES);
  const firstBreak = tail.indexOf("\n");
  const trimmed = firstBreak === -1 ? "" : tail.slice(firstBreak + 1);
  await fs.writeFile(
    file,
    `${JSON.stringify({
      kind: "note",
      at: new Date().toISOString(),
      note: "older entries trimmed to keep the audit log bounded",
    })}\n${trimmed}`,
    "utf8"
  );
}

/**
 * Appends records to the audit log. Never throws.
 *
 * Callers should not await this on the critical path — it runs after the user already has their
 * answer, and a slow disk should not hold a reply open.
 */
export async function recordAudit(
  workspaceRoot: string,
  records: readonly AuditRecord[]
): Promise<void> {
  if (records.length === 0) return;
  try {
    const dir = path.join(workspaceRoot, AUDIT_DIR);
    await fs.mkdir(dir, { recursive: true });
    const file = auditPath(workspaceRoot);
    await trimIfOversized(file);
    await fs.appendFile(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  } catch {
    // Best effort. A turn must not fail because the log couldn't be written.
  }
}

/**
 * Minimal shape of a step's content needed to spot tools the user refused.
 *
 * A denial is the single most important thing in this log — it's the record of the user saying no,
 * and of the assistant honouring it — and it's invisible in tool results, which only contain
 * things that ran.
 */
type RawContentPart = { type?: string; toolName?: string; input?: unknown } | undefined;

export function collectDenied(
  steps: readonly { readonly content?: readonly RawContentPart[] }[]
): { toolName: string; input: Record<string, unknown> }[] {
  const denied: { toolName: string; input: Record<string, unknown> }[] = [];
  for (const step of steps) {
    for (const part of step.content ?? []) {
      if (part?.type === "tool-output-denied") {
        denied.push({
          toolName: part.toolName ?? "unknown",
          input:
            part.input && typeof part.input === "object"
              ? (part.input as Record<string, unknown>)
              : {},
        });
      }
    }
  }
  return denied;
}
