import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  collectOutcomes,
  errorFrom,
  checkSignals,
  verifyTurn,
  type ToolOutcome,
} from "@/lib/critic";
import { generateText } from "ai";

// The model tier of verifyTurn is the only part that touches the network; mock it out and
// exercise the full verdict ladder (signals → self-evident → model → timeout) deterministically.
vi.mock("ai", () => ({ generateText: vi.fn() }));

const mockedGenerateText = vi.mocked(generateText);

function outcome(toolName: string, output: unknown, errored = false): ToolOutcome {
  return { toolName, input: {}, output, errored };
}

describe("collectOutcomes", () => {
  it("flattens executed tool results and marks the turn complete when all calls resolved", () => {
    const steps = [
      { toolCalls: [{ toolName: "readFile", input: { path: "a" } }], toolResults: [{ toolName: "readFile", input: { path: "a" }, output: { content: "x" } }] },
      { toolCalls: [{ toolName: "writeFile", input: { path: "b" } }], toolResults: [{ toolName: "writeFile", input: { path: "b" }, output: { success: true } }] },
    ];
    const { outcomes, complete } = collectOutcomes(steps);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.toolName).toBe("readFile");
    expect(complete).toBe(true);
  });

  it("marks the turn incomplete when a tool call has no result (e.g. awaiting approval)", () => {
    const steps = [
      { toolCalls: [{ toolName: "writeFile", input: {} }], toolResults: [] },
    ];
    const { outcomes, complete } = collectOutcomes(steps);
    expect(outcomes).toHaveLength(0);
    expect(complete).toBe(false);
  });

  it("skips undefined entries in the SDK's sparse arrays", () => {
    const steps = [{ toolCalls: [undefined], toolResults: [undefined, { toolName: "readFile", output: {} }] }];
    const { outcomes, complete } = collectOutcomes(steps);
    expect(outcomes).toHaveLength(1);
    expect(complete).toBe(false); // 1 call, 1 result — the undefined call never produced a result
  });
});

describe("errorFrom", () => {
  it("extracts a tool's own { error } report", () => {
    expect(errorFrom({ error: "boom" })).toBe("boom");
  });

  it("returns null for no error, empty error, or non-object output", () => {
    expect(errorFrom({ success: true })).toBeNull();
    expect(errorFrom({ error: "" })).toBeNull();
    expect(errorFrom("plain string")).toBeNull();
    expect(errorFrom(null)).toBeNull();
  });
});

describe("checkSignals", () => {
  it("fails on an errored tool call", () => {
    const verdict = checkSignals([outcome("writeFile", {}, true)]);
    expect(verdict?.ok).toBe(false);
    expect(verdict?.tier).toBe("signals");
  });

  it("fails on a tool's reported error", () => {
    const verdict = checkSignals([outcome("editFile", { error: "oldString not found" })]);
    expect(verdict?.ok).toBe(false);
    expect(verdict?.tier).toBe("signals");
    expect(verdict && "reason" in verdict ? verdict.reason : "").toContain("oldString not found");
  });

  it("fails when a command timed out", () => {
    const verdict = checkSignals([outcome("runCommand", { output: "", timedOut: true })]);
    expect(verdict?.ok).toBe(false);
    expect(verdict?.tier).toBe("signals");
  });

  it("returns null when nothing signals a failure", () => {
    expect(checkSignals([outcome("readFile", { content: "x" })])).toBeNull();
    expect(checkSignals([])).toBeNull();
  });
});

describe("verifyTurn", () => {
  beforeEach(() => {
    mockedGenerateText.mockReset();
  });

  it("skips verification entirely when the turn made no mutations", async () => {
    const verdict = await verifyTurn({
      request: "read me a file",
      outcomes: [outcome("readFile", { content: "x" })],
      model: {} as never,
    });
    expect(verdict).toEqual({ ok: true, tier: "not-applicable" });
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("fails fast on a mutating tool's own error, without calling the model", async () => {
    const verdict = await verifyTurn({
      request: "write a file",
      outcomes: [outcome("writeFile", { error: "path escapes the workspace root" })],
      model: {} as never,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.tier).toBe("signals");
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("passes on self-evident success without calling the model", async () => {
    const verdict = await verifyTurn({
      request: "write a file",
      outcomes: [outcome("writeFile", { success: true, path: "a.txt" })],
      model: {} as never,
    });
    expect(verdict).toEqual({ ok: true, tier: "signals" });
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("asks the model when the outcome is neither error nor self-evident, and accepts an OK", async () => {
    mockedGenerateText.mockResolvedValue({ text: "OK", finishReason: "stop" } as never);
    // runCommand reports { output } — no { error }, no { success: true } — so it is not
    // self-evident and the turn must be judged by the model tier.
    const verdict = await verifyTurn({
      request: "run the build",
      outcomes: [outcome("runCommand", { output: "build completed" })],
      model: {} as never,
    });
    expect(verdict).toEqual({ ok: true, tier: "model" });
    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
  });

  it("returns FAIL with the model's reason when the model says so", async () => {
    mockedGenerateText.mockResolvedValue({ text: "FAIL: the build is still broken", finishReason: "stop" } as never);
    const verdict = await verifyTurn({
      request: "run the build",
      outcomes: [outcome("runCommand", { output: "error: undefined symbol foo" })],
      model: {} as never,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.tier).toBe("model");
    if (!verdict.ok) expect(verdict.reason).toContain("still broken");
  });

  it("resolves to ok when the model call throws (timeout/provider error is not a failure)", async () => {
    mockedGenerateText.mockRejectedValue(new Error("timed out"));
    const verdict = await verifyTurn({
      request: "run the build",
      outcomes: [outcome("runCommand", { output: "build completed" })],
      model: {} as never,
    });
    expect(verdict).toEqual({ ok: true, tier: "timeout" });
  });
});
