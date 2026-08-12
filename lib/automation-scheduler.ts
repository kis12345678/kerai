import { listAutomations, recordRun, type Automation } from "@/lib/automation-store";
import { runAutomation } from "@/lib/automation-runner";

const CHECK_INTERVAL_MS = 60_000;

declare global {
  var __omniaiSchedulerTimer: ReturnType<typeof setInterval> | undefined;
  var __omniaiSchedulerRunning: Set<string> | undefined;
  var __omniaiSchedulerLastFireMinute: Map<string, string> | undefined;
}

function dueNow(automation: Automation, now: Date): boolean {
  if (automation.schedule.type === "interval") {
    const last = automation.lastRunAt ?? 0;
    return Date.now() - last >= automation.schedule.everyMinutes * 60_000;
  }
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (hhmm !== automation.schedule.hhmm) return false;

  const lastFired = globalThis.__omniaiSchedulerLastFireMinute?.get(automation.id);
  const minuteKey = `${now.toDateString()} ${hhmm}`;
  if (lastFired === minuteKey) return false;
  if (!globalThis.__omniaiSchedulerLastFireMinute) globalThis.__omniaiSchedulerLastFireMinute = new Map();
  globalThis.__omniaiSchedulerLastFireMinute.set(automation.id, minuteKey);
  return true;
}

async function tick() {
  const running = globalThis.__omniaiSchedulerRunning ?? (globalThis.__omniaiSchedulerRunning = new Set());
  const now = new Date();
  const automations = await listAutomations();

  for (const automation of automations) {
    if (running.has(automation.id)) continue;
    if (automation.enabled === false) continue; // paused
    if (!dueNow(automation, now)) continue;

    running.add(automation.id);
    runAutomation(automation)
      .then((result) => recordRun(automation.id, result, null))
      .catch((err) => {
        console.error(`[automation-scheduler] "${automation.label}" failed:`, err);
        return recordRun(automation.id, null, (err as Error).message);
      })
      .finally(() => running.delete(automation.id));
  }
}

export type RunNowResult =
  | { ok: true; result: string }
  | { ok: false; error: string; alreadyRunning?: boolean };

// Trigger an automation immediately (the "Run now" button), sharing the same concurrency
// guard as the scheduler so a manual run and a scheduled tick never double-execute.
export async function runAutomationNow(id: string): Promise<RunNowResult> {
  const automations = await listAutomations();
  const automation = automations.find((a) => a.id === id);
  if (!automation) return { ok: false, error: "Automation not found" };

  const running = globalThis.__omniaiSchedulerRunning ?? (globalThis.__omniaiSchedulerRunning = new Set());
  if (running.has(id)) {
    return { ok: false, error: "Already running — wait for it to finish.", alreadyRunning: true };
  }

  running.add(id);
  try {
    const result = await runAutomation(automation);
    await recordRun(id, result, null);
    return { ok: true, result };
  } catch (err) {
    const message = (err as Error).message;
    await recordRun(id, null, message);
    return { ok: false, error: message };
  } finally {
    running.delete(id);
  }
}

export function ensureSchedulerRunning(): void {
  if (globalThis.__omniaiSchedulerTimer) return;
  console.log("[automation-scheduler] starting scheduler loop");
  tick().catch((err) => console.error("[automation-scheduler] tick failed:", err));
  globalThis.__omniaiSchedulerTimer = setInterval(() => {
    tick().catch((err) => console.error("[automation-scheduler] tick failed:", err));
  }, CHECK_INTERVAL_MS);
}
