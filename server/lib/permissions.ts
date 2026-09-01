import { store } from "../store.js";
import { toolRegistry } from "./registry.js";
import { eventBus } from "./events.js";
import { run, queryAll } from "./db.js";
import type { WraithSettings, PermissionLevel, RiskLevel } from "@shared/api";

// ── Permission Types ───────────────────────────────────────────

export type PermissionDecision = "allow" | "deny" | "require_confirmation";

export interface PermissionCheck {
  toolName: string;
  permissionLevel: PermissionLevel;
  riskLevel: RiskLevel;
  settingsPermission: boolean;   // is the user's setting enabled for this category?
  needsConfirmation: boolean;    // does this tool require confirmation?
  decision: PermissionDecision;
  reason: string;
}

export interface PermissionOverride {
  toolName: string;
  allowed: boolean;
  reason: string;
  createdAt: string;
  expiresAt?: string;
}

// ── Tool → Settings Category Mapping ───────────────────────────

const TOOL_CATEGORY_MAP: Record<string, keyof WraithSettings["permissions"]> = {
  // System tools — always allowed (level 0)
  "system.get_status": "osControl",
  "system.list_processes": "osControl",
  "system.get_disk_usage": "osControl",
  "system.run_command": "osControl",

  // File tools
  "files.read": "files",
  "files.write": "files",
  "files.list": "files",

  // Automation tools
  "automation.list": "osControl",
  "automation.toggle": "osControl",

  // Integration tools — mapped to specific categories
  "integration.list": "email",
  "integration.sync": "email",

  // Logs
  "logs.read": "osControl",

  // Settings
  "settings.get": "osControl",
};

// ── Permission Engine ──────────────────────────────────────────

/**
 * KERAI Permission Engine
 *
 * Enforces authorization for all tool executions:
 * - Maps tools to user setting categories
 * - Checks permission levels (0-3)
 * - Enforces confirmation for high-risk actions
 * - Maintains an override/allowlist in SQLite
 * - Logs all permission decisions for audit
 */
class PermissionEngine {
  private overrides = new Map<string, PermissionOverride>();

  /**
   * Check if a tool call is authorized
   */
  check(toolName: string, skipConfirmation: boolean = false): PermissionCheck {
    const tool = toolRegistry.get(toolName);

    if (!tool) {
      return this.deny(toolName, 0, "none", false, false, "Tool not found");
    }

    // Level 0 tools are always allowed
    if (tool.permissionLevel === 0) {
      return this.allow(toolName, tool.permissionLevel, tool.riskLevel, true, false);
    }

    // Check user settings permission for this category
    const settings = store.settings.get();
    const settingsKey = TOOL_CATEGORY_MAP[toolName];
    const settingsPermission = settingsKey ? settings.permissions[settingsKey] : true;

    if (!settingsPermission) {
      return this.deny(
        toolName, tool.permissionLevel, tool.riskLevel,
        false, tool.requiresConfirmation,
        `Permission denied: ${settingsKey} is disabled in settings`,
      );
    }

    // Check manual overrides (allowlist/blocklist)
    const override = this.overrides.get(toolName);
    if (override) {
      if (override.expiresAt && new Date(override.expiresAt) < new Date()) {
        this.overrides.delete(toolName); // expired
      } else if (!override.allowed) {
        return this.deny(
          toolName, tool.permissionLevel, tool.riskLevel,
          true, tool.requiresConfirmation,
          `Blocked by manual override: ${override.reason}`,
        );
      }
    }

    // Level 2+ tools need confirmation (unless skipConfirmation)
    if (tool.permissionLevel >= 2 && !skipConfirmation && tool.requiresConfirmation) {
      return {
        toolName,
        permissionLevel: tool.permissionLevel,
        riskLevel: tool.riskLevel,
        settingsPermission: true,
        needsConfirmation: true,
        decision: "require_confirmation",
        reason: `Level ${tool.permissionLevel} tool requires user confirmation`,
      };
    }

    // Level 3 (high-risk) always logs a warning
    if (tool.permissionLevel === 3) {
      eventBus.emit("permission.granted", "permissions", {
        toolName,
        level: tool.permissionLevel,
        riskLevel: tool.riskLevel,
        warning: "High-risk tool executed",
      }, "warn");
    }

    return this.allow(toolName, tool.permissionLevel, tool.riskLevel, true, tool.requiresConfirmation);
  }

  /**
   * Grant a manual override (allow/block a tool)
   */
  setOverride(toolName: string, allowed: boolean, reason: string, expiresMinutes?: number): void {
    const override: PermissionOverride = {
      toolName,
      allowed,
      reason,
      createdAt: new Date().toISOString(),
      expiresAt: expiresMinutes
        ? new Date(Date.now() + expiresMinutes * 60000).toISOString()
        : undefined,
    };

    this.overrides.set(toolName, override);

    // Persist to DB
    run(
      `INSERT OR REPLACE INTO audit_log (id, action, entity_type, entity_id, actor, details, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `perm-${Date.now()}`,
      allowed ? "override.allow" : "override.block",
      "tool",
      toolName,
      "user",
      JSON.stringify({ reason, expiresMinutes }),
      new Date().toISOString(),
    );

    eventBus.emit(allowed ? "permission.granted" : "permission.denied", "permissions", {
      toolName,
      allowed,
      reason,
    }, allowed ? "info" : "warn");
  }

  /**
   * Remove a manual override
   */
  clearOverride(toolName: string): void {
    this.overrides.delete(toolName);
  }

  /**
   * Get all active overrides
   */
  getOverrides(): PermissionOverride[] {
    return Array.from(this.overrides.values());
  }

  /**
   * Get permission audit log
   */
  getAuditLog(limit: number = 100): Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actor: string;
    details: string | null;
    timestamp: string;
  }> {
    return queryAll<{
      id: string; action: string; entity_type: string; entity_id: string | null;
      actor: string; details: string | null; timestamp: string;
    }>(
      `SELECT * FROM audit_log WHERE action LIKE 'override.%' OR action LIKE 'permission.%' ORDER BY timestamp DESC LIMIT ?`,
      limit,
    ).map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      actor: r.actor,
      details: r.details,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Get a summary of the current permission state
   */
  getStatus(): {
    totalTools: number;
    allowedTools: number;
    blockedTools: number;
    confirmationRequiredTools: number;
    overrides: number;
    settingsPermissions: Record<string, boolean>;
  } {
    const tools = toolRegistry.getAll();
    const settings = store.settings.get();

    let allowed = 0;
    let blocked = 0;
    let confirmRequired = 0;

    for (const tool of tools) {
      const check = this.check(tool.name);
      if (check.decision === "allow") allowed++;
      else if (check.decision === "deny") blocked++;
      else if (check.decision === "require_confirmation") confirmRequired++;
    }

    return {
      totalTools: tools.length,
      allowedTools: allowed,
      blockedTools: blocked,
      confirmationRequiredTools: confirmRequired,
      overrides: this.overrides.size,
      settingsPermissions: { ...settings.permissions },
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  private allow(
    toolName: string,
    permissionLevel: PermissionLevel,
    riskLevel: RiskLevel,
    settingsPermission: boolean,
    needsConfirmation: boolean,
  ): PermissionCheck {
    return {
      toolName,
      permissionLevel,
      riskLevel,
      settingsPermission,
      needsConfirmation,
      decision: "allow",
      reason: "Authorized",
    };
  }

  private deny(
    toolName: string,
    permissionLevel: PermissionLevel,
    riskLevel: RiskLevel,
    settingsPermission: boolean,
    needsConfirmation: boolean,
    reason: string,
  ): PermissionCheck {
    eventBus.emit("permission.denied", "permissions", {
      toolName,
      permissionLevel,
      reason,
    }, "warn");

    return {
      toolName,
      permissionLevel,
      riskLevel,
      settingsPermission,
      needsConfirmation,
      decision: "deny",
      reason,
    };
  }
}

export const permissions = new PermissionEngine();
