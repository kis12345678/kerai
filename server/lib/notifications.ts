import { run, queryAll, queryOne } from "./db.js";
import { eventBus } from "./events.js";
import { store } from "../store.js";
import crypto from "node:crypto";
import type { KeraiEvent } from "@shared/api";

// ── Notification Types ─────────────────────────────────────────

export type NotificationType = "info" | "success" | "warning" | "error" | "task" | "workflow" | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  source: string;
  read: boolean;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ── Notification Engine ────────────────────────────────────────

/**
 * KERAI Notification Engine
 *
 * Manages in-app notifications:
 * - Create notifications manually or from events
 * - Auto-notify on task completion, workflow success/failure, errors
 * - Mark as read / mark all read
 * - Get unread count
 * - Prune old notifications
 */
class NotificationEngine {
  private listeners: Set<() => void> = new Set();

  /**
   * Create a notification
   */
  create(data: {
    type: NotificationType;
    title: string;
    message: string;
    source?: string;
    actionUrl?: string;
    metadata?: Record<string, unknown>;
  }): Notification {
    const id = `notif-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const notif: Notification = {
      id,
      type: data.type,
      title: data.title,
      message: data.message,
      source: data.source || "kerai",
      read: false,
      actionUrl: data.actionUrl,
      metadata: data.metadata,
      createdAt: now,
    };

    run(
      `INSERT INTO notifications (id, type, title, message, source, read, action_url, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      notif.type,
      notif.title,
      notif.message,
      notif.source,
      0,
      notif.actionUrl || null,
      notif.metadata ? JSON.stringify(notif.metadata) : null,
      now,
    );

    // Notify frontend listeners
    this.notifyListeners();

    return notif;
  }

  /**
   * Get all notifications (newest first)
   */
  getAll(limit: number = 50): Notification[] {
    return queryAll<{
      id: string; type: string; title: string; message: string; source: string;
      read: number; action_url: string | null; metadata: string | null; created_at: string;
    }>(
      `SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`,
      limit,
    ).map(this.rowToNotif);
  }

  /**
   * Get unread notifications
   */
  getUnread(limit: number = 50): Notification[] {
    return queryAll<{
      id: string; type: string; title: string; message: string; source: string;
      read: number; action_url: string | null; metadata: string | null; created_at: string;
    }>(
      `SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?`,
      limit,
    ).map(this.rowToNotif);
  }

  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return (queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM notifications WHERE read = 0`
    ))?.count || 0;
  }

  /**
   * Mark a notification as read
   */
  markRead(id: string): void {
    run(`UPDATE notifications SET read = 1 WHERE id = ?`, id);
    this.notifyListeners();
  }

  /**
   * Mark all notifications as read
   */
  markAllRead(): number {
    const result = run(`UPDATE notifications SET read = 1 WHERE read = 0`);
    this.notifyListeners();
    return result.changes;
  }

  /**
   * Delete a notification
   */
  delete(id: string): boolean {
    const result = run(`DELETE FROM notifications WHERE id = ?`, id);
    if (result.changes > 0) this.notifyListeners();
    return result.changes > 0;
  }

  /**
   * Clear all notifications
   */
  clearAll(): number {
    const result = run(`DELETE FROM notifications`);
    if (result.changes > 0) this.notifyListeners();
    return result.changes;
  }

  /**
   * Prune old notifications (older than N days)
   */
  prune(olderThanDays: number = 7): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const result = run(`DELETE FROM notifications WHERE created_at < ?`, cutoff);
    return result.changes;
  }

  /**
   * Subscribe to notification changes (for frontend polling)
   */
  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch {}
    }
  }

  private rowToNotif(row: {
    id: string; type: string; title: string; message: string; source: string;
    read: number; action_url: string | null; metadata: string | null; created_at: string;
  }): Notification {
    return {
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      message: row.message,
      source: row.source,
      read: row.read === 1,
      actionUrl: row.action_url || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    };
  }
}

export const notifications = new NotificationEngine();

// ── Auto-Notification Subscribers ──────────────────────────────

/**
 * Set up automatic notifications for key events.
 * Called once at server startup.
 */
export function setupAutoNotifications(): void {
  console.log("[notifications] Setting up auto-notification subscribers...");

  // Task completed
  eventBus.on("task.completed", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    notifications.create({
      type: "success",
      title: "Task Completed",
      message: `Task finished successfully${data.stepCount ? ` (${data.stepCount} steps)` : ""}`,
      source: "task-engine",
      actionUrl: "/tasks",
      metadata: data,
    });
  });

  // Task failed
  eventBus.on("task.failed", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    notifications.create({
      type: "error",
      title: "Task Failed",
      message: data.error ? `Task failed: ${data.error}` : "A task failed to complete",
      source: "task-engine",
      actionUrl: "/tasks",
      metadata: data,
    });
  });

  // Workflow completed
  eventBus.on("automation.completed", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    if (data.success) {
      notifications.create({
        type: "workflow",
        title: "Workflow Executed",
        message: `Workflow completed${data.stepCount ? ` (${data.stepCount} steps)` : ""}${data.durationMs ? ` in ${(Number(data.durationMs) / 1000).toFixed(1)}s` : ""}`,
        source: "workflow-engine",
        actionUrl: "/workflows",
        metadata: data,
      });
    }
  });

  // Workflow failed
  eventBus.on("automation.failed", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    notifications.create({
      type: "error",
      title: "Workflow Failed",
      message: (data.error as string) || "A workflow failed to execute",
      source: "scheduler",
      actionUrl: "/workflows",
      metadata: data,
    });
  });

  // Permission denied
  eventBus.on("permission.denied", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    notifications.create({
      type: "warning",
      title: "Permission Denied",
      message: `Tool "${data.toolName}" was blocked: ${data.reason || "not authorized"}`,
      source: "permissions",
      metadata: data,
    });
  });

  // System errors
  eventBus.on("system.error", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    notifications.create({
      type: "error",
      title: "System Error",
      message: data.error || "An unexpected error occurred",
      source: "system",
      metadata: data,
    });
  });

  // LLM errors
  eventBus.on("llm.error", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    notifications.create({
      type: "warning",
      title: "AI Provider Error",
      message: `${data.provider || "Unknown"} error: ${data.error || "request failed"}`,
      source: "llm-router",
      metadata: data,
    });
  });

  // Tool errors
  eventBus.on("tool.error", (event) => {
    const data = (event.data || {}) as Record<string, any>;
    notifications.create({
      type: "error",
      title: "Tool Error",
      message: `Tool "${data.toolName}" failed: ${data.error}`,
      source: "tool-registry",
      metadata: data,
    });
  });

  // Prune old notifications every hour
  setInterval(() => {
    const pruned = notifications.prune(7);
    if (pruned > 0) console.log(`[notifications] Pruned ${pruned} old notifications`);
  }, 3600000);

  console.log("[notifications] ✅ Auto-notification subscribers registered");
}
