import { promises as fs } from "node:fs";
import path from "node:path";

export type RunRecord = {
  at: number;
  result: string | null;
  error: string | null;
};

export type Automation = {
  id: string;
  label: string;
  prompt: string;
  workspaceRoot: string;
  model: string;
  // Deliberately simple — a real cron parser is more than this needs. "daily" fires once per
  // day at hh:mm local time; "interval" fires every N minutes. Both are checked on a 60s tick.
  schedule: { type: "daily"; hhmm: string } | { type: "interval"; everyMinutes: number };
  createdAt: number;
  enabled: boolean; // false = paused; scheduler skips it
  lastRunAt: number | null;
  lastResult: string | null;
  lastError: string | null;
  runs: RunRecord[]; // rolling run history, most recent last, capped at MAX_RUN_HISTORY
};

export type AutomationInput = Omit<
  Automation,
  "id" | "createdAt" | "enabled" | "lastRunAt" | "lastResult" | "lastError" | "runs"
>;

const MAX_RUN_HISTORY = 10;
const STORE_PATH = path.join(process.cwd(), ".omniai-schedules.json");

async function readStore(): Promise<Automation[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Automation[];
    // Tolerate entries written by older versions (missing `enabled` / `runs`).
    return parsed.map((a) => ({
      ...a,
      enabled: a.enabled ?? true,
      runs: a.runs ?? [],
    }));
  } catch {
    return [];
  }
}

async function writeStore(automations: Automation[]): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(automations, null, 2), "utf8");
}

export async function listAutomations(): Promise<Automation[]> {
  return readStore();
}

export async function createAutomation(input: AutomationInput): Promise<Automation> {
  const automations = await readStore();
  const automation: Automation = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    enabled: true,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
    runs: [],
  };
  automations.push(automation);
  await writeStore(automations);
  return automation;
}

export async function updateAutomation(id: string, patch: Partial<AutomationInput>): Promise<Automation | null> {
  const automations = await readStore();
  const idx = automations.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  automations[idx] = { ...automations[idx], ...patch, id };
  await writeStore(automations);
  return automations[idx];
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<Automation | null> {
  const automations = await readStore();
  const idx = automations.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  automations[idx] = { ...automations[idx], enabled };
  await writeStore(automations);
  return automations[idx];
}

export async function deleteAutomation(id: string): Promise<void> {
  const automations = await readStore();
  await writeStore(automations.filter((a) => a.id !== id));
}

export async function recordRun(id: string, result: string | null, error: string | null): Promise<void> {
  const automations = await readStore();
  const idx = automations.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const now = Date.now();
  const runs = [...automations[idx].runs, { at: now, result, error }].slice(-MAX_RUN_HISTORY);
  automations[idx] = {
    ...automations[idx],
    lastRunAt: now,
    lastResult: result,
    lastError: error,
    runs,
  };
  await writeStore(automations);
}
