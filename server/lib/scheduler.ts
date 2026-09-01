import { run, queryAll, queryOne } from "./db.js";
import { eventBus } from "./events.js";
import { workflowEngine, type WorkflowRunResult } from "./workflows.js";
import { memory } from "./memory.js";
import crypto from "node:crypto";

// ── Schedule Types ─────────────────────────────────────────────

export type ScheduleTriggerType = "cron" | "interval" | "once" | "event";

export interface ScheduleConfig {
  /** Cron expression (5 fields: minute hour day-of-month month day-of-week) */
  cron?: string;
  /** Interval in minutes (for "interval" type) */
  intervalMinutes?: number;
  /** One-time run at ISO timestamp */
  runAt?: string;
  /** Event type to listen for */
  eventType?: string;
  /** Event source filter */
  eventSource?: string;
}

export interface Schedule {
  id: string;
  workflowId?: string;
  name: string;
  triggerType: ScheduleTriggerType;
  triggerConfig: ScheduleConfig;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  lastResult?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Simple Cron Parser ─────────────────────────────────────────

function parseCron(expr: string): {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
} | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function parseField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  const values: number[] = [];

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [start, step] = part.split("/").map(Number);
      for (let i = start; i <= max; i += step) {
        values.push(i);
      }
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let i = lo; i <= hi; i++) {
        values.push(i);
      }
    } else {
      values.push(parseInt(part, 10));
    }
  }

  return values.filter((v) => !isNaN(v) && v >= min && v <= max);
}

function getNextCronRun(cronExpr: string, after?: Date): Date | null {
  const parsed = parseCron(cronExpr);
  if (!parsed) return null;

  const now = after || new Date();
  const next = new Date(now);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Try up to 366 days ahead
  for (let dayOffset = 0; dayOffset < 366; dayOffset++) {
    const candidate = new Date(next);
    candidate.setDate(candidate.getDate() + dayOffset);

    if (dayOffset > 0) {
      candidate.setMinutes(0);
      candidate.setHours(0);
    }

    if (!parsed.month.includes(candidate.getMonth() + 1)) continue;
    if (!parsed.dayOfMonth.includes(candidate.getDate())) continue;
    if (!parsed.dayOfWeek.includes(candidate.getDay())) continue;

    for (const hour of parsed.hour) {
      candidate.setHours(hour);
      for (const minute of parsed.minute) {
        candidate.setMinutes(minute);
        if (candidate > now) return candidate;
      }
    }
  }

  return null;
}

// ── Scheduler Engine ───────────────────────────────────────────

/**
 * KERAI Scheduler
 *
 * Manages time-based and event-based triggers:
 * - Cron expressions (every minute, daily, weekly, etc.)
 * - Fixed intervals
 * - One-time scheduled runs
 * - Event-based triggers (listen for event bus events)
 */
export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private eventUnsubscribers: (() => void)[] = [];

  /**
   * Create a new schedule
   */
  create(data: {
    workflowId?: string;
    name: string;
    triggerType: ScheduleTriggerType;
    triggerConfig: ScheduleConfig;
    enabled?: boolean;
  }): Schedule {
    const id = `sched-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    let nextRunAt: string | null = null;
    if (data.triggerType === "cron" && data.triggerConfig.cron) {
      const next = getNextCronRun(data.triggerConfig.cron);
      nextRunAt = next?.toISOString() || null;
    } else if (data.triggerType === "interval" && data.triggerConfig.intervalMinutes) {
      const next = new Date(Date.now() + data.triggerConfig.intervalMinutes * 60000);
      nextRunAt = next.toISOString();
    } else if (data.triggerType === "once" && data.triggerConfig.runAt) {
      nextRunAt = data.triggerConfig.runAt;
    }

    run(
      `INSERT INTO schedules (id, workflow_id, name, trigger_type, trigger_config, enabled, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.workflowId || null,
      data.name,
      data.triggerType,
      JSON.stringify(data.triggerConfig),
      data.enabled !== false ? 1 : 0,
      nextRunAt,
      now,
      now,
    );

    const schedule = this.getById(id)!;

    // Start the timer if enabled
    if (schedule.enabled) {
      this.startTimer(schedule);
    }

    eventBus.emit("automation.started", "scheduler", { scheduleId: id, name: data.name });
    return schedule;
  }

  /**
   * Execute a schedule's workflow
   */
  async execute(scheduleId: string): Promise<{ success: boolean; result?: WorkflowRunResult; error?: string }> {
    const schedule = this.getById(scheduleId);
    if (!schedule) return { success: false, error: `Schedule "${scheduleId}" not found` };

    if (!schedule.workflowId) {
      return { success: false, error: "Schedule has no linked workflow" };
    }

    const now = new Date().toISOString();

    try {
      const result = await workflowEngine.execute(schedule.workflowId);

      // Update schedule state
      this.update(scheduleId, {
        lastRunAt: now,
        runCount: schedule.runCount + 1,
        lastResult: JSON.stringify({ success: result.success, stepCount: result.steps.length }),
      });

      // Recalculate next run
      this.recalcNextRun(scheduleId);

      // Store in memory
      memory.store("episodic", `schedule:${scheduleId}:${Date.now()}`, `${schedule.name}: completed`, {
        tags: ["schedule", "automation", result.success ? "success" : "failure"],
        metadata: { scheduleId, workflowId: schedule.workflowId, success: result.success },
      });

      return { success: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      this.update(scheduleId, {
        lastRunAt: now,
        runCount: schedule.runCount + 1,
        lastResult: JSON.stringify({ success: false, error }),
      });

      this.recalcNextRun(scheduleId);

      eventBus.emit("automation.failed", "scheduler", { scheduleId, error }, "error");
      return { success: false, error };
    }
  }

  /**
   * Get all schedules
   */
  getAll(limit: number = 50): Schedule[] {
    return queryAll<{
      id: string; workflow_id: string | null; name: string; trigger_type: string;
      trigger_config: string; enabled: number; last_run_at: string | null;
      next_run_at: string | null; run_count: number; last_result: string | null;
      created_at: string; updated_at: string;
    }>(`SELECT * FROM schedules ORDER BY next_run_at ASC NULLS LAST, updated_at DESC LIMIT ?`, limit)
      .map(this.rowToSchedule);
  }

  /**
   * Get a schedule by ID
   */
  getById(id: string): Schedule | undefined {
    const row = queryOne<{
      id: string; workflow_id: string | null; name: string; trigger_type: string;
      trigger_config: string; enabled: number; last_run_at: string | null;
      next_run_at: string | null; run_count: number; last_result: string | null;
      created_at: string; updated_at: string;
    }>(`SELECT * FROM schedules WHERE id = ?`, id);
    return row ? this.rowToSchedule(row) : undefined;
  }

  /**
   * Update a schedule
   */
  update(id: string, patch: Partial<Schedule>): Schedule | null {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];

    if (patch.name !== undefined) { sets.push("name = ?"); params.push(patch.name); }
    if (patch.triggerType !== undefined) { sets.push("trigger_type = ?"); params.push(patch.triggerType); }
    if (patch.triggerConfig !== undefined) { sets.push("trigger_config = ?"); params.push(JSON.stringify(patch.triggerConfig)); }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?"); params.push(patch.enabled ? 1 : 0);
    }
    if (patch.lastRunAt !== undefined) { sets.push("last_run_at = ?"); params.push(patch.lastRunAt); }
    if (patch.nextRunAt !== undefined) { sets.push("next_run_at = ?"); params.push(patch.nextRunAt); }
    if (patch.runCount !== undefined) { sets.push("run_count = ?"); params.push(patch.runCount); }
    if (patch.lastResult !== undefined) { sets.push("last_result = ?"); params.push(patch.lastResult); }

    params.push(id);
    run(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`, ...params);

    // Restart timer if enabled state changed
    const updated = this.getById(id);
    if (updated) {
      this.clearTimer(id);
      if (updated.enabled) this.startTimer(updated);
    }

    return updated;
  }

  /**
   * Delete a schedule
   */
  delete(id: string): boolean {
    this.clearTimer(id);
    const result = run(`DELETE FROM schedules WHERE id = ?`, id);
    return result.changes > 0;
  }

  /**
   * Toggle enabled/disabled
   */
  toggle(id: string): Schedule | null {
    const sched = this.getById(id);
    if (!sched) return null;
    return this.update(id, { enabled: !sched.enabled });
  }

  /**
   * Start the scheduler — called at server startup
   */
  start(): void {
    console.log("[scheduler] Starting scheduler...");

    // Start timers for all enabled schedules
    const schedules = queryAll<{ id: string; enabled: number }>(
      `SELECT id, enabled FROM schedules WHERE enabled = 1`
    );
    for (const s of schedules) {
      const sched = this.getById(s.id);
      if (sched) this.startTimer(sched);
    }

    // Listen for event-based triggers
    this.eventUnsubscribers.push(
      eventBus.on("*", async (event) => {
        const eventSchedules = queryAll<{
          id: string; trigger_config: string;
        }>(
          `SELECT id, trigger_config FROM schedules WHERE enabled = 1 AND trigger_type = 'event'`
        );

        for (const s of eventSchedules) {
          const config: ScheduleConfig = JSON.parse(s.trigger_config);
          if (config.eventType && config.eventType === event.type) {
            if (!config.eventSource || config.eventSource === event.source) {
              console.log(`[scheduler] Event trigger: ${event.type} → executing ${s.id}`);
              await this.execute(s.id);
            }
          }
        }
      }),
    );

    console.log(`[scheduler] Started ${schedules.length} active schedule(s)`);
  }

  /**
   * Stop all timers
   */
  stop(): void {
    for (const [id] of this.timers) {
      this.clearTimer(id);
    }
    for (const unsub of this.eventUnsubscribers) {
      unsub();
    }
    this.eventUnsubscribers = [];
  }

  // ── Internal ──────────────────────────────────────────────

  private startTimer(schedule: Schedule): void {
    if (schedule.triggerType === "cron" && schedule.triggerConfig.cron) {
      const nextRun = getNextCronRun(schedule.triggerConfig.cron);
      if (!nextRun) return;

      const delayMs = nextRun.getTime() - Date.now();
      if (delayMs <= 0) return;

      const timer = setTimeout(async () => {
        await this.execute(schedule.id);
      }, delayMs);

      this.timers.set(schedule.id, timer);
      console.log(`[scheduler] Timer set for "${schedule.name}" at ${nextRun.toLocaleTimeString()}`);

    } else if (schedule.triggerType === "interval" && schedule.triggerConfig.intervalMinutes) {
      const intervalMs = schedule.triggerConfig.intervalMinutes * 60000;
      const timer = setInterval(async () => {
        await this.execute(schedule.id);
      }, intervalMs);

      // Store as setTimeout chain so we can clear it
      this.timers.set(schedule.id, timer as any);

    } else if (schedule.triggerType === "once" && schedule.triggerConfig.runAt) {
      const runAt = new Date(schedule.triggerConfig.runAt);
      const delayMs = runAt.getTime() - Date.now();
      if (delayMs <= 0) return;

      const timer = setTimeout(async () => {
        await this.execute(schedule.id);
      }, delayMs);

      this.timers.set(schedule.id, timer);
    }
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  private recalcNextRun(id: string): void {
    const schedule = this.getById(id);
    if (!schedule || !schedule.enabled) return;

    let nextRunAt: string | null = null;

    if (schedule.triggerType === "cron" && schedule.triggerConfig.cron) {
      const next = getNextCronRun(schedule.triggerConfig.cron, new Date());
      nextRunAt = next?.toISOString() || null;
    } else if (schedule.triggerType === "interval" && schedule.triggerConfig.intervalMinutes) {
      nextRunAt = new Date(Date.now() + schedule.triggerConfig.intervalMinutes * 60000).toISOString();
    }

    if (nextRunAt) {
      run(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, nextRunAt, id);
    }
  }

  private rowToSchedule(row: {
    id: string; workflow_id: string | null; name: string; trigger_type: string;
    trigger_config: string; enabled: number; last_run_at: string | null;
    next_run_at: string | null; run_count: number; last_result: string | null;
    created_at: string; updated_at: string;
  }): Schedule {
    return {
      id: row.id,
      workflowId: row.workflow_id || undefined,
      name: row.name,
      triggerType: row.trigger_type as ScheduleTriggerType,
      triggerConfig: JSON.parse(row.trigger_config),
      enabled: row.enabled === 1,
      lastRunAt: row.last_run_at || undefined,
      nextRunAt: row.next_run_at || undefined,
      runCount: row.run_count,
      lastResult: row.last_result || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const scheduler = new Scheduler();
