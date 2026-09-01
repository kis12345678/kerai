import { run, queryAll, queryOne } from "./db.js";
import { toolRegistry } from "./registry.js";
import { eventBus } from "./events.js";
import { planner, type Plan } from "./planner.js";
import { llmRouter } from "./llm-router.js";
import { memory } from "./memory.js";
import type { Task, TaskStep, TaskStatus, LLMMessage } from "@shared/api";
import crypto from "node:crypto";

// ── Task Engine ────────────────────────────────────────────────

/**
 * KERAI Task Engine
 *
 * Executes plans step by step:
 * - Creates tasks from plans
 * - Runs tools for each step
 * - Tracks progress in real-time
 * - Handles errors with retries
 * - Records everything for audit
 * - Generates natural language responses from results
 */
export class TaskEngine {
  /**
   * Create a task from a plan and execute it
   */
  async execute(message: string): Promise<TaskResult> {
    // Step 1: Plan
    const plan = await planner.plan(message);

    // Step 2: Create task in SQLite
    const task = this.createTask(plan);

    eventBus.emit("task.started", "task-engine", {
      taskId: task.id,
      objective: task.objective,
      stepCount: task.steps.length,
    });

    // Step 3: If no steps (conversation), generate a response
    if (task.steps.length === 0) {
      const response = await this.generateConversationResponse(message);
      this.updateTask(task.id, { status: "completed", result: response });
      eventBus.emit("task.completed", "task-engine", { taskId: task.id });
      return { task: this.getTask(task.id)!, response };
    }

    // Step 4: Execute steps sequentially
    const stepResults: StepResult[] = [];
    let allSucceeded = true;

    for (const step of task.steps) {
      // Update step status
      this.updateStep(task.id, step.id, { status: "executing", startedAt: new Date().toISOString() });
      this.updateTask(task.id, { status: "executing" });

      let result: StepResult;

      if (!step.toolName) {
        // No tool needed — skip
        result = { step, success: true, output: null, durationMs: 0 };
      } else {
        result = await this.executeStep(task.id, step);
      }

      stepResults.push(result);

      if (result.success) {
        this.updateStep(task.id, step.id, {
          status: "completed",
          result: {
            success: true,
            output: result.output,
            durationMs: result.durationMs,
            toolName: step.toolName || "",
            timestamp: new Date().toISOString(),
          },
          completedAt: new Date().toISOString(),
        });
      } else {
        allSucceeded = false;
        this.updateStep(task.id, step.id, {
          status: "failed",
          result: {
            success: false,
            error: result.error,
            durationMs: result.durationMs,
            toolName: step.toolName || "",
            timestamp: new Date().toISOString(),
          },
          completedAt: new Date().toISOString(),
        });

        // Stop on failure (don't continue with broken steps)
        this.updateTask(task.id, {
          status: "failed",
          error: result.error,
          completedAt: new Date().toISOString(),
        });

        eventBus.emit("task.failed", "task-engine", {
          taskId: task.id,
          failedStep: step.id,
          error: result.error,
        });

        break;
      }
    }

    // Step 5: Generate natural language response from results
    let response: string;
    if (allSucceeded) {
      response = await this.generateSummaryResponse(message, stepResults);
      this.updateTask(task.id, {
        status: "completed",
        result: response,
        completedAt: new Date().toISOString(),
      });
      eventBus.emit("task.completed", "task-engine", { taskId: task.id, stepCount: stepResults.length });

      // Store completed task as episodic memory
      memory.store("episodic", `task:${task.id}`, response, {
        tags: ["task", "completed", ...stepResults.map((r) => r.step.toolName || "unknown").filter(Boolean)],
        metadata: {
          taskId: task.id,
          objective: message,
          tools: stepResults.map((r) => r.step.toolName).filter(Boolean),
          stepCount: stepResults.length,
        },
      });
    } else {
      const failedStep = stepResults.find((r) => !r.success);
      response = `Task failed at step "${failedStep?.step.description || "unknown"}": ${failedStep?.error || "unknown error"}`;
      this.updateTask(task.id, { status: "failed", error: response });
    }

    return { task: this.getTask(task.id)!, response, stepResults };
  }

  /**
   * Execute a single step
   */
  private async executeStep(taskId: string, step: TaskStep): Promise<StepResult> {
    const start = Date.now();

    if (!step.toolName) {
      return { step, success: true, output: null, durationMs: 0 };
    }

    try {
      const result = await toolRegistry.execute(step.toolName, step.input || {}, taskId);
      return {
        step,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { step, success: false, error, durationMs: Date.now() - start };
    }
  }

  /**
   * Generate a conversation response (no tools needed)
   */
  private async generateConversationResponse(message: string): Promise<string> {
    try {
      const messages: LLMMessage[] = [{ role: "user", content: message }];
      const response = await llmRouter.generate(messages, undefined, { temperature: 0.7 });
      return response.text;
    } catch {
      return "I received your message but couldn't generate a response right now.";
    }
  }

  /**
   * Generate a natural language summary from step results
   */
  private async generateSummaryResponse(originalMessage: string, results: StepResult[]): Promise<string> {
    const toolOutputs = results.map((r) => ({
      tool: r.step.toolName,
      description: r.step.description,
      output: r.output,
    }));

    const systemPrompt = `You are KERAI. Summarize the results of a completed task in a friendly, conversational way.
The user asked: "${originalMessage}"

Tool execution results:
${JSON.stringify(toolOutputs, null, 2)}

Respond in 1-3 sentences. Be warm and helpful. Don't mention "tools" or "APIs" — just describe what you found/did.`;

    try {
      const response = await llmRouter.generate(
        [{ role: "user", content: "Summarize the results" }],
        systemPrompt,
        { temperature: 0.3 },
      );
      return response.text;
    } catch {
      // Fallback: build a simple summary
      const summaries = results.map((r) => {
        const output = r.output as any;
        if (r.step.toolName?.startsWith("system.")) {
          return output ? `System status: CPU ${output.cpu}%, Memory ${output.memory}%` : "System info retrieved";
        }
        if (r.step.toolName?.startsWith("files.")) {
          return output?.content ? `File contents loaded (${output.size} bytes)` : "File listing retrieved";
        }
        return `${r.step.description} completed`;
      });
      return summaries.join(". ") + ".";
    }
  }

  // ── Database Operations ────────────────────────────────────

  private createTask(plan: Plan): Task {
    const id = `task-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    run(
      `INSERT INTO tasks (id, objective, plan, steps, status, permission_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      plan.objective,
      JSON.stringify([plan.reasoning]),
      JSON.stringify(plan.steps),
      "queued",
      plan.estimatedPermissions,
      now,
      now,
    );

    return this.getTask(id)!;
  }

  private getTask(id: string): Task | undefined {
    const row = queryOne<{
      id: string; objective: string; plan: string; steps: string;
      status: string; result: string | null; error: string | null;
      permission_level: number; created_at: string; updated_at: string;
      completed_at: string | null;
    }>(`SELECT * FROM tasks WHERE id = ?`, id);

    if (!row) return undefined;

    return {
      id: row.id,
      objective: row.objective,
      plan: JSON.parse(row.plan),
      steps: JSON.parse(row.steps),
      status: row.status as TaskStatus,
      result: row.result || undefined,
      error: row.error || undefined,
      permissionLevel: row.permission_level as 0 | 1 | 2 | 3,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
    };
  }

  private updateTask(id: string, patch: Partial<{
    status: TaskStatus;
    result: string;
    error: string;
    completedAt: string;
  }>): void {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];

    if (patch.status) { sets.push("status = ?"); params.push(patch.status); }
    if (patch.result !== undefined) { sets.push("result = ?"); params.push(patch.result); }
    if (patch.error !== undefined) { sets.push("error = ?"); params.push(patch.error); }
    if (patch.completedAt) { sets.push("completed_at = ?"); params.push(patch.completedAt); }

    params.push(id);
    run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, ...params);
  }

  private updateStep(taskId: string, stepId: string, patch: Partial<TaskStep & { startedAt: string; completedAt: string }>): void {
    // Read current task, update the step in the JSON array
    const row = queryOne<{ steps: string }>(`SELECT steps FROM tasks WHERE id = ?`, taskId);
    if (!row) return;

    const steps: TaskStep[] = JSON.parse(row.steps);
    const idx = steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return;

    if (patch.status) steps[idx].status = patch.status;
    if (patch.result) steps[idx].result = patch.result as any;
    if (patch.startedAt) steps[idx].startedAt = patch.startedAt;
    if (patch.completedAt) steps[idx].completedAt = patch.completedAt;

    run(`UPDATE tasks SET steps = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(steps), new Date().toISOString(), taskId);
  }

  // ── Query Operations ───────────────────────────────────────

  /**
   * Get all tasks
   */
  getAll(limit: number = 50): Task[] {
    const rows = queryAll<{
      id: string; objective: string; plan: string; steps: string;
      status: string; result: string | null; error: string | null;
      permission_level: number; created_at: string; updated_at: string;
      completed_at: string | null;
    }>(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?`, limit);

    return rows.map((r) => ({
      id: r.id,
      objective: r.objective,
      plan: JSON.parse(r.plan),
      steps: JSON.parse(r.steps),
      status: r.status as TaskStatus,
      result: r.result || undefined,
      error: r.error || undefined,
      permissionLevel: r.permission_level as 0 | 1 | 2 | 3,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || undefined,
    }));
  }

  /**
   * Get a single task
   */
  getById(id: string): Task | undefined {
    return this.getTask(id);
  }

  /**
   * Cancel a running task
   */
  cancel(id: string): boolean {
    const task = this.getTask(id);
    if (!task) return false;
    if (task.status === "completed" || task.status === "cancelled") return false;

    this.updateTask(id, { status: "cancelled", completedAt: new Date().toISOString() });
    eventBus.emit("task.cancelled", "task-engine", { taskId: id });
    return true;
  }

  /**
   * Get stats
   */
  getStats(): { total: number; byStatus: Record<string, number> } {
    const rows = queryAll<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM tasks GROUP BY status`
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }
    return { total, byStatus };
  }
}

export const taskEngine = new TaskEngine();

// ── Types ──────────────────────────────────────────────────────

interface StepResult {
  step: TaskStep;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface TaskResult {
  task: Task;
  response: string;
  stepResults?: StepResult[];
}
