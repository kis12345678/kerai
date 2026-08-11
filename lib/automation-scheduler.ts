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

export function ensureSchedulerRunning(): void {
  if (globalThis.__omniaiSchedulerTimer) return;
  console.log("[automation-scheduler] starting scheduler loop");
  tick().catch((err) => console.error("[automation-scheduler] tick failed:", err));
  globalThis.__omniaiSchedulerTimer = setInterval(() => {
    tick().catch((err) => console.error("[automation-scheduler] tick failed:", err));
  }, CHECK_INTERVAL_MS);
}
