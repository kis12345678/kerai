import { describe, it, expect } from "vitest";
import {
  TOOL_RISK,
  isMutatingTool,
  unclassifiedTools,
  buildToolApproval,
} from "@/lib/tool-risk";

describe("unclassifiedTools", () => {
  it("reports tools with no risk entry so they fail closed to approval", () => {
    expect(unclassifiedTools(["writeFile", "bogusTool", "readFile"])).toEqual(["bogusTool"]);
  });

  it("returns empty when everything is classified", () => {
    expect(unclassifiedTools(Object.keys(TOOL_RISK))).toEqual([]);
  });
});

describe("isMutatingTool", () => {
  it("treats reads as non-mutating and writes as mutating", () => {
    expect(isMutatingTool("readFile")).toBe(false);
    expect(isMutatingTool("searchFiles")).toBe(false);
    expect(isMutatingTool("writeFile")).toBe(true);
    expect(isMutatingTool("editFile")).toBe(true);
    expect(isMutatingTool("runCommand")).toBe(true);
    expect(isMutatingTool("gitCommit")).toBe(true);
  });

  it("applies argument-aware policies", () => {
    expect(isMutatingTool("openApp", { app: "spotify" })).toBe(false); // allowlisted
    expect(isMutatingTool("openApp", { app: "Spotify" })).toBe(false); // case-insensitive
    expect(isMutatingTool("openApp", { app: "cmd" })).toBe(true); // shell — gated
    expect(isMutatingTool("openApp", { app: "weird-game.exe" })).toBe(true); // unknown — gated
    expect(isMutatingTool("systemControl", { action: "volume up" })).toBe(false);
    expect(isMutatingTool("systemControl", { action: "lock" })).toBe(true); // interrupts work
  });

  it("fails closed on unclassified tools", () => {
    expect(isMutatingTool("someBrandNewTool")).toBe(true);
  });
});

describe("buildToolApproval", () => {
  const map = buildToolApproval(["readFile", "writeFile", "openApp", "systemControl", "bogusTool"]);

  it("maps safe tools to not-applicable", () => {
    expect(map.readFile).toBe("not-applicable");
  });

  it("maps gated tools to user-approval", () => {
    expect(map.writeFile).toBe("user-approval");
    expect(map.bogusTool).toBe("user-approval"); // unclassified still gated
  });

  it("keeps argument-aware tools as functions that decide per call", () => {
    expect(typeof map.openApp).toBe("function");
    expect(typeof map.systemControl).toBe("function");
    const openApp = map.openApp as (input: Record<string, unknown>) => string;
    const systemControl = map.systemControl as (input: Record<string, unknown>) => string;
    expect(openApp({ app: "spotify" })).toBe("not-applicable");
    expect(openApp({ app: "cmd" })).toBe("user-approval");
    expect(systemControl({ action: "volume up" })).toBe("not-applicable");
    expect(systemControl({ action: "lock" })).toBe("user-approval");
  });
});
