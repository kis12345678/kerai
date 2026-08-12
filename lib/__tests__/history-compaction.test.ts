import { describe, it, expect } from "vitest";
import { compactMessages } from "@/lib/history-compaction";
import type { UIMessage } from "ai";

function msg(
  id: string,
  role: "user" | "assistant",
  text: string,
  tools: string[] = []
): UIMessage {
  return {
    id,
    role,
    parts: [
      { type: "text", text },
      ...tools.map((toolName) => ({ type: "dynamic-tool", toolCallId: `${id}-${toolName}`, toolName })),
    ],
  } as UIMessage;
}

function conversation(n: number, textSize: number): UIMessage[] {
  return Array.from({ length: n }, (_, i) =>
    msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", "x".repeat(textSize))
  );
}

describe("compactMessages", () => {
  it("leaves short conversations untouched", () => {
    const messages = conversation(10, 100); // ~1k chars, well under budget
    expect(compactMessages(messages)).toBe(messages);
  });

  it("leaves conversations at or under MIN_KEPT_MESSAGES untouched even if huge", () => {
    const messages = conversation(6, 50_000); // 300k chars, but only 6 messages
    expect(compactMessages(messages)).toBe(messages);
  });

  it("prepends a digest and keeps whole messages when over budget", () => {
    const messages = conversation(30, 10_000); // 300k chars > 120k budget
    const compacted = compactMessages(messages);

    expect(compacted.length).toBeLessThan(messages.length);
    expect(compacted.length).toBeGreaterThanOrEqual(6);

    // Every message is either the digest or one of the originals — nothing is fabricated.
    const ids = new Set(messages.map((m) => m.id));
    for (const m of compacted.slice(1)) expect(ids.has(m.id)).toBe(true);

    // The digest is first and says it condensed the history.
    const digest = compacted[0]!;
    expect(digest.id.startsWith("compaction-digest-")).toBe(true);
    const digestText = digest.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("");
    expect(digestText).toContain("Earlier in this conversation");
  });

  it("records which tools ran in the dropped span, without their payloads", () => {
    // 8 × 20k chars, tools on the two oldest messages — those two get dropped (the 6-message
    // floor keeps the tail), so their tool names must survive into the digest.
    const messages = [
      msg("m0", "user", "y".repeat(20_000), ["readFile"]),
      msg("m1", "assistant", "a".repeat(20_000), ["writeFile", "runCommand"]),
      msg("m2", "user", "b".repeat(20_000)),
      msg("m3", "assistant", "c".repeat(20_000)),
      msg("m4", "user", "d".repeat(20_000)),
      msg("m5", "assistant", "e".repeat(20_000)),
      msg("m6", "user", "f".repeat(20_000)),
      msg("m7", "assistant", "g".repeat(20_000)),
    ];
    const compacted = compactMessages(messages);
    expect(compacted[0]!.id.startsWith("compaction-digest-")).toBe(true);
    const digestText = compacted[0]!.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("");
    expect(digestText).toContain("writeFile");
    expect(digestText).toContain("runCommand");
    expect(digestText).toContain("readFile");
  });

  it("never splits a message: kept messages are byte-identical to the originals", () => {
    const messages = conversation(25, 10_000);
    const compacted = compactMessages(messages);
    const originals = new Map(messages.map((m) => [m.id, m]));
    for (const m of compacted.slice(1)) {
      expect(m).toBe(originals.get(m.id)); // same object — not reconstructed
    }
  });
});
