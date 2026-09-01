import { run, queryAll } from "./db.js";
import type { KeraiEvent, KeraiEventType } from "@shared/api";
import crypto from "node:crypto";

type EventHandler = (event: KeraiEvent) => void;

/**
 * KERAI Event Bus
 *
 * Structured event system that:
 * - Publishes events to in-memory subscribers (real-time)
 * - Persists all events to SQLite (audit trail)
 * - Supports filtering by type, source, severity
 * - Retains last N events in memory for activity feeds
 */
class EventBus {
  private subscribers = new Map<string, Set<EventHandler>>();
  private wildcardSubscribers = new Set<EventHandler>();
  private recentEvents: KeraiEvent[] = [];
  private maxRecent = 200;

  /**
   * Emit an event — persists to DB and notifies subscribers
   */
  private evtCounter = 0;

  emit(
    type: KeraiEventType,
    source: string,
    data?: Record<string, unknown>,
    severity: KeraiEvent["severity"] = "info",
  ): KeraiEvent {
    this.evtCounter += 1;
    const event: KeraiEvent = {
      id: `evt-${Date.now()}-${this.evtCounter}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      source,
      data,
      timestamp: new Date().toISOString(),
      severity,
    };

    // Persist to SQLite
    try {
      run(
        `INSERT INTO events (id, type, source, data, severity, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        event.id,
        event.type,
        event.source,
        event.data ? JSON.stringify(event.data) : null,
        event.severity,
        event.timestamp,
      );
    } catch (err) {
      console.error("[event-bus] Failed to persist event:", err);
    }

    // Add to recent buffer
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents = this.recentEvents.slice(-this.maxRecent);
    }

    // Notify subscribers
    const typeSubs = this.subscribers.get(type);
    if (typeSubs) {
      for (const handler of typeSubs) {
        try { handler(event); } catch (err) { console.error("[event-bus] Subscriber error:", err); }
      }
    }
    for (const handler of this.wildcardSubscribers) {
      try { handler(event); } catch (err) { console.error("[event-bus] Wildcard subscriber error:", err); }
    }

    return event;
  }

  /**
   * Subscribe to a specific event type (or "*" for all)
   */
  on(typeOrWildcard: string, handler: EventHandler): () => void {
    if (typeOrWildcard === "*") {
      this.wildcardSubscribers.add(handler);
      return () => { this.wildcardSubscribers.delete(handler); };
    }
    if (!this.subscribers.has(typeOrWildcard)) {
      this.subscribers.set(typeOrWildcard, new Set());
    }
    this.subscribers.get(typeOrWildcard)!.add(handler);
    return () => { this.subscribers.get(typeOrWildcard)?.delete(handler); };
  }

  /**
   * Get recent events from memory buffer
   */
  getRecent(limit?: number): KeraiEvent[] {
    const events = [...this.recentEvents].reverse();
    return limit ? events.slice(0, limit) : events;
  }

  /**
   * Query persisted events from SQLite
   */
  query(filters: {
    type?: KeraiEventType;
    source?: string;
    severity?: KeraiEvent["severity"];
    since?: string;
    limit?: number;
  } = {}): KeraiEvent[] {
    let sql = `SELECT id, type, source, data, severity, timestamp FROM events WHERE 1=1`;
    const params: unknown[] = [];

    if (filters.type) {
      sql += ` AND type = ?`;
      params.push(filters.type);
    }
    if (filters.source) {
      sql += ` AND source = ?`;
      params.push(filters.source);
    }
    if (filters.severity) {
      sql += ` AND severity = ?`;
      params.push(filters.severity);
    }
    if (filters.since) {
      sql += ` AND timestamp >= ?`;
      params.push(filters.since);
    }

    sql += ` ORDER BY timestamp DESC`;
    if (filters.limit) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    const rows = queryAll<{ id: string; type: string; source: string; data: string | null; severity: string; timestamp: string }>(sql, ...params);

    return rows.map((r) => ({
      id: r.id,
      type: r.type as KeraiEventType,
      source: r.source,
      data: r.data ? JSON.parse(r.data) : undefined,
      severity: r.severity as KeraiEvent["severity"],
      timestamp: r.timestamp,
    }));
  }

  /**
   * Clear old events from SQLite (cleanup)
   */
  prune(olderThanDays: number = 30): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const result = run(`DELETE FROM events WHERE timestamp < ?`, cutoff);
    return result.changes;
  }
}

export const eventBus = new EventBus();
