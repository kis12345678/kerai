import { describe, it, expect } from "vitest";
import {
  explicitAgent,
  confidentAgent,
  bestGuessAgent,
  scoreAgents,
  lastUserText,
} from "@/lib/agent-router";
import type { UIMessage } from "ai";

function msg(role: "user" | "assistant", text: string): UIMessage {
  return { id: crypto.randomUUID(), role, parts: [{ type: "text", text }] } as UIMessage;
}

describe("explicitAgent", () => {
  it("addresses an agent by name at the start, with a separator", () => {
    expect(explicitAgent("Ultron, fix this")).toBe("ultron");
    expect(explicitAgent("ultron: build me an app")).toBe("ultron");
    expect(explicitAgent("hey friday what's my battery")).toBe("friday");
    expect(explicitAgent("okay jarvis, look this up")).toBe("jarvis");
    expect(explicitAgent("JARVIS — search for it")).toBe("jarvis");
  });

  it("routes ask/tell constructions without needing a separator", () => {
    expect(explicitAgent("ask jarvis to look this up")).toBe("jarvis");
    expect(explicitAgent("tell ultron to refactor it")).toBe("ultron");
  });

  it("ignores mere mentions that are not addressing the agent", () => {
    expect(explicitAgent("Ultron wrote this earlier")).toBeNull();
    expect(explicitAgent("jarvis")).toBeNull();
    expect(explicitAgent("what did friday say about the battery yesterday")).toBeNull();
  });
});

describe("confidentAgent", () => {
  it("routes machine-state questions to friday", () => {
    expect(confidentAgent("what's my battery and cpu load")).toBe("friday");
  });

  it("routes playback requests to friday over jarvis's web words", () => {
    // "play" (5) + "youtube" (2) beats any research signal
    expect(confidentAgent("play despacito on youtube")).toBe("friday");
  });

  it("routes explanation requests to jarvis", () => {
    expect(confidentAgent("explain the difference between react and vue")).toBe("jarvis");
  });

  it("routes build requests to ultron", () => {
    expect(confidentAgent("build a todo app")).toBe("ultron");
  });

  it("returns null on bare question words, whose weight is near zero", () => {
    expect(confidentAgent("what is 2+2")).toBeNull();
  });

  it("returns null when the top two agents tie (no margin)", () => {
    // jarvis: "explain" (3) · ultron: "commit" (3) — no confident winner
    expect(confidentAgent("commit and explain the changes")).toBeNull();
  });
});

describe("bestGuessAgent", () => {
  it("falls back to the highest scorer even when not confident", () => {
    expect(bestGuessAgent("what is 2+2")).toBe("jarvis");
  });

  it("is deterministic on ties (stable order)", () => {
    expect(bestGuessAgent("commit and explain the changes")).toBe("jarvis");
  });
});

describe("scoreAgents", () => {
  it("scores each agent independently by its weighted hints", () => {
    const scores = scoreAgents("play despacito on youtube");
    expect(scores.friday).toBe(7); // play(5) + youtube(2)
    expect(scores.jarvis).toBe(0);
    expect(scores.ultron).toBe(0);
  });
});

describe("lastUserText", () => {
  it("returns the text of the most recent user message", () => {
    const messages = [
      msg("user", "first question"),
      msg("assistant", "first answer"),
      msg("user", "second question"),
    ];
    expect(lastUserText(messages)).toBe("second question");
  });

  it("skips trailing assistant messages and searches backwards", () => {
    const messages = [msg("user", "the question"), msg("assistant", "the answer")];
    expect(lastUserText(messages)).toBe("the question");
  });

  it("returns empty string when there is no user message", () => {
    expect(lastUserText([msg("assistant", "hi")])).toBe("");
  });
});
