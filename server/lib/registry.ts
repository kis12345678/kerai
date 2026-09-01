import { run, queryAll, queryOne } from "./db.js";
import { eventBus } from "./events.js";
import { permissions } from "./permissions.js";
import crypto from "node:crypto";
import type { ToolDefinition, ToolResult, ToolCategory, PermissionLevel, RiskLevel } from "@shared/api";

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

/**
 * KERAI Tool Registry
 *
 * Dynamic tool registration system that:
 * - Stores tool definitions in SQLite
 * - Supports runtime registration and lookup
 * - Tracks execution history
 * - Enforces permission levels
 * - Provides tool call validation
 */
class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  /**
   * Register a tool with its definition and handler
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    // Store in SQLite
    run(
      `INSERT OR REPLACE INTO tools
       (name, description, category, input_schema, output_schema,
        permission_level, risk_level, requires_confirmation, provider,
        enabled, timeout, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      definition.name,
      definition.description,
      definition.category,
      JSON.stringify(definition.inputSchema),
      JSON.stringify(definition.outputSchema),
      definition.permissionLevel,
      definition.riskLevel,
      definition.requiresConfirmation ? 1 : 0,
      definition.provider,
      definition.enabled ? 1 : 0,
      definition.timeout,
      definition.retryCount,
    );

    // Store handler in memory
    this.handlers.set(definition.name, handler);

    eventBus.emit("tool.registered", "registry", {
      toolName: definition.name,
      category: definition.category,
      provider: definition.provider,
    });

    console.log(`[tool-registry] Registered: ${definition.name} (${definition.category}/${definition.provider})`);
  }

  /**
   * Get a tool definition by name
   */
  get(name: string): (ToolDefinition & { hasHandler: boolean }) | undefined {
    const row = queryOne<{
      name: string; description: string; category: string;
      input_schema: string; output_schema: string;
      permission_level: number; risk_level: string;
      requires_confirmation: number; provider: string;
      enabled: number; timeout: number; retry_count: number;
    }>(`SELECT * FROM tools WHERE name = ?`, name);

    if (!row) return undefined;

    return {
      name: row.name,
      description: row.description,
      category: row.category as ToolCategory,
      inputSchema: JSON.parse(row.input_schema),
      outputSchema: JSON.parse(row.output_schema),
      permissionLevel: row.permission_level as PermissionLevel,
      riskLevel: row.risk_level as RiskLevel,
      requiresConfirmation: row.requires_confirmation === 1,
      provider: row.provider,
      enabled: row.enabled === 1,
      timeout: row.timeout,
      retryCount: row.retry_count,
      hasHandler: this.handlers.has(row.name),
    };
  }

  /**
   * Get all registered tools
   */
  getAll(): (ToolDefinition & { hasHandler: boolean })[] {
    const rows = queryAll<{
      name: string; description: string; category: string;
      input_schema: string; output_schema: string;
      permission_level: number; risk_level: string;
      requires_confirmation: number; provider: string;
      enabled: number; timeout: number; retry_count: number;
    }>(`SELECT * FROM tools ORDER BY category, name`);

    return rows.map((row) => ({
      name: row.name,
      description: row.description,
      category: row.category as ToolCategory,
      inputSchema: JSON.parse(row.input_schema),
      outputSchema: JSON.parse(row.output_schema),
      permissionLevel: row.permission_level as PermissionLevel,
      riskLevel: row.risk_level as RiskLevel,
      requiresConfirmation: row.requires_confirmation === 1,
      provider: row.provider,
      enabled: row.enabled === 1,
      timeout: row.timeout,
      retryCount: row.retry_count,
      hasHandler: this.handlers.has(row.name),
    }));
  }

  /**
   * Get tools by category
   */
  getByCategory(category: ToolCategory): (ToolDefinition & { hasHandler: boolean })[] {
    return this.getAll().filter((t) => t.category === category);
  }

  /**
   * Get tools by provider
   */
  getByProvider(provider: string): (ToolDefinition & { hasHandler: boolean })[] {
    return this.getAll().filter((t) => t.provider === provider);
  }

  /**
   * Enable or disable a tool
   */
  setEnabled(name: string, enabled: boolean): void {
    run(`UPDATE tools SET enabled = ? WHERE name = ?`, enabled ? 1 : 0, name);
  }

  /**
   * Check if a tool exists and is enabled
   */
  isAvailable(name: string): boolean {
    const tool = this.get(name);
    return tool !== undefined && tool.enabled;
  }

  /**
   * Get the handler for a tool
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /**
   * Execute a tool and record the run.
   * Pass skipConfirmation=true to bypass the confirmation gate (e.g. when already confirmed by the user).
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    taskId?: string,
    skipConfirmation: boolean = false,
  ): Promise<ToolResult> {
    const tool = this.get(toolName);
    const start = Date.now();

    if (!tool) {
      const result: ToolResult = {
        success: false,
        error: `Tool "${toolName}" not found`,
        durationMs: 0,
        toolName,
        timestamp: new Date().toISOString(),
      };
      this.recordRun(result, input, taskId);
      return result;
    }

    if (!tool.enabled) {
      const result: ToolResult = {
        success: false,
        error: `Tool "${toolName}" is disabled`,
        durationMs: 0,
        toolName,
        timestamp: new Date().toISOString(),
      };
      this.recordRun(result, input, taskId);
      eventBus.emit("tool.denied", "registry", { toolName, reason: "disabled" }, "warn");
      return result;
    }

    // ── Permission check ────────────────────────────────────
    const permCheck = permissions.check(toolName, skipConfirmation);
    if (permCheck.decision === "deny") {
      const result: ToolResult = {
        success: false,
        error: `Permission denied: ${permCheck.reason}`,
        durationMs: 0,
        toolName,
        timestamp: new Date().toISOString(),
      };
      this.recordRun(result, input, taskId);
      return result;
    }
    if (permCheck.decision === "require_confirmation") {
      const result: ToolResult = {
        success: false,
        error: `Confirmation required: ${permCheck.reason}`,
        durationMs: 0,
        toolName,
        timestamp: new Date().toISOString(),
      };
      this.recordRun(result, input, taskId);
      return result;
    }

    const handler = this.handlers.get(toolName);
    if (!handler) {
      const result: ToolResult = {
        success: false,
        error: `No handler registered for "${toolName}"`,
        durationMs: 0,
        toolName,
        timestamp: new Date().toISOString(),
      };
      this.recordRun(result, input, taskId);
      return result;
    }

    eventBus.emit("tool.invoked", "registry", { toolName, input });

    try {
      const output = await Promise.race([
        handler(input),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${tool.timeout}ms`)), tool.timeout)
        ),
      ]);

      const result: ToolResult = {
        success: true,
        output,
        durationMs: Date.now() - start,
        toolName,
        timestamp: new Date().toISOString(),
      };

      this.recordRun(result, input, taskId);
      eventBus.emit("tool.completed", "registry", { toolName, durationMs: result.durationMs });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: ToolResult = {
        success: false,
        error,
        durationMs: Date.now() - start,
        toolName,
        timestamp: new Date().toISOString(),
      };

      this.recordRun(result, input, taskId);
      eventBus.emit("tool.error", "registry", { toolName, error }, "error");
      return result;
    }
  }

  /**
   * Record a tool run in SQLite
   */
  private recordRun(result: ToolResult, input: Record<string, unknown>, taskId?: string): void {
    try {
      run(
        `INSERT INTO tool_runs (id, tool_name, input, output, success, error, duration_ms, task_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        result.toolName,
        JSON.stringify(input),
        result.output ? JSON.stringify(result.output) : null,
        result.success ? 1 : 0,
        result.error || null,
        result.durationMs,
        taskId || null,
        result.timestamp,
      );
    } catch (err) {
      console.error("[tool-registry] Failed to record run:", err);
    }
  }

  /**
   * Get recent tool runs
   */
  getRecentRuns(limit: number = 50): Array<{
    id: string; toolName: string; input: unknown;
    output: unknown; success: boolean; error: string | null;
    durationMs: number; taskId: string | null; createdAt: string;
  }> {
    return queryAll<{
      id: string; tool_name: string; input: string | null;
      output: string | null; success: number; error: string | null;
      duration_ms: number | null; task_id: string | null; created_at: string;
    }>(
      `SELECT * FROM tool_runs ORDER BY created_at DESC LIMIT ?`,
      limit,
    ).map((r) => ({
      id: r.id,
      toolName: r.tool_name,
      input: r.input ? JSON.parse(r.input) : null,
      output: r.output ? JSON.parse(r.output) : null,
      success: r.success === 1,
      error: r.error,
      durationMs: r.duration_ms ?? 0,
      taskId: r.task_id,
      createdAt: r.created_at,
    }));
  }
}

export const toolRegistry = new ToolRegistry();
