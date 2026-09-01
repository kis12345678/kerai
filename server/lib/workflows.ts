import { run, queryAll, queryOne } from "./db.js";
import { toolRegistry } from "./registry.js";
import { eventBus } from "./events.js";
import { memory } from "./memory.js";
import type { ToolResult } from "@shared/api";
import crypto from "node:crypto";

// ── Workflow Types ─────────────────────────────────────────────

export type WorkflowTriggerType = "manual" | "cron" | "event" | "webhook";

export interface WorkflowStep {
  id: string;
  order: number;
  description: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Variable reference: use output of previous step as input. e.g. "$step1.output.path" */
  inputFromStep?: string;
  /** Skip this step if condition is false */
  condition?: string;
}

export interface WorkflowCondition {
  field: string;      // e.g. "step1.output.success"
  operator: "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "exists";
  value: unknown;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  triggerType: WorkflowTriggerType;
  triggerConfig: Record<string, unknown>;
  steps: WorkflowStep[];
  conditions: WorkflowCondition[];
  enabled: boolean;
  runCount: number;
  lastRunAt?: string;
  lastRunResult?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  runId: string;
  success: boolean;
  steps: Array<{
    stepId: string;
    description: string;
    toolName: string;
    success: boolean;
    output?: unknown;
    error?: string;
    durationMs: number;
  }>;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

// ── Workflow Engine ────────────────────────────────────────────

/**
 * KERAI Workflow Engine
 *
 * Executes reusable multi-step automations:
 * - Chains tool outputs as inputs to subsequent steps
 * - Evaluates conditions before each step
 * - Records run history
 * - Stores results as episodic memory
 */
export class WorkflowEngine {
  /**
   * Create a new workflow
   */
  create(data: {
    name: string;
    description?: string;
    triggerType?: WorkflowTriggerType;
    triggerConfig?: Record<string, unknown>;
    steps: WorkflowStep[];
    conditions?: WorkflowCondition[];
    enabled?: boolean;
  }): Workflow {
    const id = `wf-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    run(
      `INSERT INTO workflows (id, name, description, trigger_type, trigger_config, steps, conditions, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.description || "",
      data.triggerType || "manual",
      JSON.stringify(data.triggerConfig || {}),
      JSON.stringify(data.steps),
      JSON.stringify(data.conditions || []),
      data.enabled !== false ? 1 : 0,
      now,
      now,
    );

    eventBus.emit("automation.started", "workflow-engine", { workflowId: id, name: data.name });
    return this.getById(id)!;
  }

  /**
   * Execute a workflow
   */
  async execute(workflowId: string): Promise<WorkflowRunResult> {
    const workflow = this.getById(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);
    if (!workflow.enabled) throw new Error(`Workflow "${workflowId}" is disabled`);

    const runId = `wfr-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const stepResults: WorkflowRunResult["steps"] = [];
    let allSucceeded = true;
    const stepOutputs: Record<string, unknown> = {};

    for (const step of workflow.steps) {
      // Check step condition
      if (step.condition) {
        const conditionMet = evaluateCondition(step.condition, stepOutputs);
        if (!conditionMet) {
          stepResults.push({
            stepId: step.id,
            description: step.description,
            toolName: step.toolName,
            success: true,
            output: { skipped: true, reason: "condition not met" },
            durationMs: 0,
          });
          continue;
        }
      }

      // Resolve input variables from previous steps
      const resolvedInput = resolveStepInput(step, stepOutputs);

      const start = Date.now();
      try {
        const result = await toolRegistry.execute(step.toolName, resolvedInput, workflowId, true);
        const durationMs = Date.now() - start;

        stepResults.push({
          stepId: step.id,
          description: step.description,
          toolName: step.toolName,
          success: result.success,
          output: result.output,
          error: result.error,
          durationMs,
        });

        // Store output for variable resolution
        stepOutputs[step.id] = result.output;

        if (!result.success) {
          allSucceeded = false;
          break;
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        stepResults.push({
          stepId: step.id,
          description: step.description,
          toolName: step.toolName,
          success: false,
          error,
          durationMs: Date.now() - start,
        });
        allSucceeded = false;
        break;
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    const result: WorkflowRunResult = {
      workflowId,
      runId,
      success: allSucceeded,
      steps: stepResults,
      durationMs,
      startedAt,
      completedAt,
    };

    // Update workflow run count
    run(
      `UPDATE workflows SET run_count = run_count + 1, last_run_at = ?, last_run_result = ?, updated_at = ? WHERE id = ?`,
      startedAt,
      JSON.stringify({ success: allSucceeded, stepCount: stepResults.length }),
      completedAt,
      workflowId,
    );

    // Store as episodic memory
    memory.store("episodic", `workflow:${workflowId}:${runId}`, `${workflow.name}: ${allSucceeded ? "completed" : "failed"} (${stepResults.length} steps)`, {
      tags: ["workflow", allSucceeded ? "success" : "failure", workflow.name],
      metadata: { workflowId, runId, success: allSucceeded, stepCount: stepResults.length, durationMs },
    });

    eventBus.emit("automation.completed", "workflow-engine", {
      workflowId,
      runId,
      success: allSucceeded,
      stepCount: stepResults.length,
      durationMs,
    });

    return result;
  }

  /**
   * Get all workflows
   */
  getAll(limit: number = 50): Workflow[] {
    return queryAll<{
      id: string; name: string; description: string; trigger_type: string;
      trigger_config: string; steps: string; conditions: string;
      enabled: number; run_count: number; last_run_at: string | null;
      last_run_result: string | null; created_at: string; updated_at: string;
    }>(`SELECT * FROM workflows ORDER BY updated_at DESC LIMIT ?`, limit).map(this.rowToWorkflow);
  }

  /**
   * Get a workflow by ID
   */
  getById(id: string): Workflow | undefined {
    const row = queryOne<{
      id: string; name: string; description: string; trigger_type: string;
      trigger_config: string; steps: string; conditions: string;
      enabled: number; run_count: number; last_run_at: string | null;
      last_run_result: string | null; created_at: string; updated_at: string;
    }>(`SELECT * FROM workflows WHERE id = ?`, id);
    return row ? this.rowToWorkflow(row) : undefined;
  }

  /**
   * Update a workflow
   */
  update(id: string, patch: Partial<Omit<Workflow, "id" | "createdAt" | "updatedAt" | "runCount">>): Workflow | null {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];

    if (patch.name !== undefined) { sets.push("name = ?"); params.push(patch.name); }
    if (patch.description !== undefined) { sets.push("description = ?"); params.push(patch.description); }
    if (patch.triggerType !== undefined) { sets.push("trigger_type = ?"); params.push(patch.triggerType); }
    if (patch.triggerConfig !== undefined) { sets.push("trigger_config = ?"); params.push(JSON.stringify(patch.triggerConfig)); }
    if (patch.steps !== undefined) { sets.push("steps = ?"); params.push(JSON.stringify(patch.steps)); }
    if (patch.conditions !== undefined) { sets.push("conditions = ?"); params.push(JSON.stringify(patch.conditions)); }
    if (patch.enabled !== undefined) { sets.push("enabled = ?"); params.push(patch.enabled ? 1 : 0); }

    params.push(id);
    run(`UPDATE workflows SET ${sets.join(", ")} WHERE id = ?`, ...params);
    return this.getById(id);
  }

  /**
   * Delete a workflow
   */
  delete(id: string): boolean {
    const result = run(`DELETE FROM workflows WHERE id = ?`, id);
    return result.changes > 0;
  }

  /**
   * Toggle enabled/disabled
   */
  toggle(id: string): Workflow | null {
    const wf = this.getById(id);
    if (!wf) return null;
    return this.update(id, { enabled: !wf.enabled });
  }

  private rowToWorkflow(row: {
    id: string; name: string; description: string; trigger_type: string;
    trigger_config: string; steps: string; conditions: string;
    enabled: number; run_count: number; last_run_at: string | null;
    last_run_result: string | null; created_at: string; updated_at: string;
  }): Workflow {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      triggerType: row.trigger_type as WorkflowTriggerType,
      triggerConfig: JSON.parse(row.trigger_config),
      steps: JSON.parse(row.steps),
      conditions: JSON.parse(row.conditions),
      enabled: row.enabled === 1,
      runCount: row.run_count,
      lastRunAt: row.last_run_at || undefined,
      lastRunResult: row.last_run_result || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const workflowEngine = new WorkflowEngine();

// ── Helpers ────────────────────────────────────────────────────

function resolveStepInput(step: WorkflowStep, stepOutputs: Record<string, unknown>): Record<string, unknown> {
  const input = { ...step.input };

  // Resolve $stepId.output.field references
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.startsWith("$")) {
      const resolved = resolveVariable(value, stepOutputs);
      if (resolved !== undefined) input[key] = resolved;
    }
  }

  // Resolve inputFromStep shorthand
  if (step.inputFromStep) {
    const [stepId, ...path] = step.inputFromStep.split(".");
    const output = stepOutputs[stepId];
    if (output && typeof output === "object") {
      let val: any = output;
      for (const p of path) {
        val = val?.[p];
      }
      if (val !== undefined) {
        input._fromStep = val;
      }
    }
  }

  return input;
}

function resolveVariable(ref: string, stepOutputs: Record<string, unknown>): unknown {
  // Format: $stepId.output.field or $stepId.output
  const match = ref.match(/^\$(\w+)\.(.+)$/);
  if (!match) return undefined;

  const [, stepId, path] = match;
  const output = stepOutputs[stepId];
  if (!output) return undefined;

  let val: any = output;
  for (const p of path.split(".")) {
    val = val?.[p];
  }
  return val;
}

function evaluateCondition(condition: string, stepOutputs: Record<string, unknown>): boolean {
  // Simple condition format: "$stepId.output.field === value"
  // or "stepId.output.field exists"
  const parts = condition.split(/\s+(===|!==|>|<|contains|exists)\s+/);
  if (parts.length === 1 && parts[0].includes("exists")) {
    const ref = parts[0].replace(" exists", "").trim();
    const val = resolveVariable(ref.startsWith("$") ? ref : `$${ref}`, stepOutputs);
    return val !== undefined && val !== null;
  }
  if (parts.length === 3) {
    const [left, op, right] = parts;
    const leftVal = resolveVariable(left.startsWith("$") ? left : `$${left}`, stepOutputs);
    const rightVal = isNaN(Number(right)) ? right.replace(/['"]/g, "") : Number(right);

    switch (op) {
      case "===": return leftVal === rightVal;
      case "!==": return leftVal !== rightVal;
      case ">": return Number(leftVal) > Number(rightVal);
      case "<": return Number(leftVal) < Number(rightVal);
      case "contains": return String(leftVal).includes(String(rightVal));
      default: return false;
    }
  }

  return true; // Default: pass
}
