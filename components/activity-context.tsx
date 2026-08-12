"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Live view of the agent turn currently running in the chat panel, shared with the dashboard so
 * "what is Kerai AI doing right now" is answerable from anywhere in the app.
 *
 * The ChatPanel is the only writer; the dashboard only reads. State is deliberately coarse —
 * active/agent/last tool — enough for a status card, not a transcript.
 */
export type ActivityState = {
  /** A turn is streaming (or submitted) in the chat panel. */
  active: boolean;
  /** Which specialist Kerai AI assigned the turn to, once the reply starts streaming. */
  agentName?: string;
  agentEmoji?: string;
  agentAccent?: string;
  /** The most recent tool the agent invoked during the current turn. */
  lastTool?: string;
};

type ActivityContextValue = {
  activity: ActivityState;
  setActive: (active: boolean) => void;
  setAgent: (agent: { name: string; emoji: string; accentClass: string }) => void;
  // undefined clears it — a new turn starts with no tool until one actually streams.
  setLastTool: (tool: string | undefined) => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<ActivityState>({ active: false });

  const setActive = useCallback((active: boolean) => {
    setActivity((prev) => ({ ...prev, active }));
  }, []);

  const setAgent = useCallback((agent: { name: string; emoji: string; accentClass: string }) => {
    setActivity((prev) => ({
      ...prev,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      agentAccent: agent.accentClass,
    }));
  }, []);

  const setLastTool = useCallback((lastTool: string | undefined) => {
    setActivity((prev) => ({ ...prev, lastTool }));
  }, []);

  return <ActivityContext.Provider value={{ activity, setActive, setAgent, setLastTool }}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity must be used within ActivityProvider");
  return ctx;
}
