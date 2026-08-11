import { promises as fs } from "node:fs";
import path from "node:path";

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
  lastRunAt: number | null;
  lastResult: string | null;
  lastError: string | null;
};

const STORE_PATH = path.join(process.cwd(), ".omniai-schedules.json");

async function readStore(): Promise<Automation[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as Automation[];
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

export async function createAutomation(
  input: Omit<Automation, "id" | "createdAt" | "lastRunAt" | "lastResult" | "lastError">
): Promise<Automation> {
  const automations = await readStore();
  const automation: Automation = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  };
  automations.push(automation);
  await writeStore(automations);
  return automation;
}

export async function deleteAutomation(id: string): Promise<void> {
  const automations = await readStore();
  await writeStore(automations.filter((a) => a.id !== id));
}

export async function recordRun(id: string, result: string | null, error: string | null): Promise<void> {
  const automations = await readStore();
  const idx = automations.findIndex((a) => a.id === id);
  if (idx === -1) return;
  automations[idx] = { ...automations[idx], lastRunAt: Date.now(), lastResult: result, lastError: error };
  await writeStore(automations);
}
