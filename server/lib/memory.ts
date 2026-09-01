import { run, queryAll, queryOne } from "./db.js";
import { eventBus } from "./events.js";
import crypto from "node:crypto";
import type { MemoryLayer, MemoryEntry } from "@shared/api";

// ── Privacy Filter ─────────────────────────────────────────────

/**
 * Patterns that should NEVER be stored as memory.
 * Per spec §4: "Never store passwords, API keys, OAuth secrets or credentials as ordinary memory."
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /token/i,
  /oauth/i,
  /bearer/i,
  /authorization/i,
  /credential/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /client[_-]?secret/i,
  /ghp_[a-zA-Z0-9]/,        // GitHub PATs
  /sk-[a-zA-Z0-9]{20,}/,    // OpenAI keys
  /AIza[a-zA-Z0-9_-]{35}/,  // Google API keys
  /xox[bpsa]-[a-zA-Z0-9-]+/, // Slack tokens
];

function containsSensitiveData(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

// ── Memory Manager ─────────────────────────────────────────────

/**
 * KERAI Memory System
 *
 * Four-layer architecture per spec §4:
 *
 * 1. SHORT-TERM — current conversation, current request, current task
 *    - Auto-expires after 30 minutes
 *    - Fast write/read, ephemeral
 *
 * 2. WORKING — current project, current files, current objective
 *    - Auto-expires after 4 hours
 *    - Temporarily relevant context
 *
 * 3. LONG-TERM — user preferences, useful facts, recurring workflows
 *    - Persists indefinitely until explicitly deleted
 *    - Tagged and searchable
 *
 * 4. EPISODIC — previous tasks, completed workflows, important events
 *    - Persists indefinitely
 *    - Records what happened and what was learned
 */
class MemoryManager {
  // ── Store ──────────────────────────────────────────────────

  /**
   * Store a memory entry
   */
  store(
    layer: MemoryLayer,
    key: string,
    value: string,
    options: {
      tags?: string[];
      metadata?: Record<string, unknown>;
      expiresInMinutes?: number;
    } = {},
  ): MemoryEntry | null {
    // Privacy check
    if (containsSensitiveData(value)) {
      console.warn(`[memory] Blocked storing sensitive data in ${layer} memory (key: ${key})`);
      eventBus.emit("memory.stored", "memory", {
        layer, key, blocked: true, reason: "sensitive data",
      }, "warn");
      return null;
    }

    const id = `mem-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const expiresAt = options.expiresInMinutes
      ? new Date(Date.now() + options.expiresInMinutes * 60000).toISOString()
      : this.getDefaultExpiry(layer);

    const entry: MemoryEntry = {
      id,
      layer,
      key,
      value,
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      tags: options.tags || [],
    };

    run(
      `INSERT INTO memory (id, layer, key, value, metadata, tags, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      layer,
      key,
      value,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      JSON.stringify(entry.tags),
      now,
      now,
      expiresAt,
    );

    eventBus.emit("memory.stored", "memory", { layer, key, id });
    return entry;
  }

  /**
   * Store with deduplication — if a memory with the same key+layer exists, update it
   */
  upsert(
    layer: MemoryLayer,
    key: string,
    value: string,
    options: {
      tags?: string[];
      metadata?: Record<string, unknown>;
      expiresInMinutes?: number;
    } = {},
  ): MemoryEntry | null {
    // Check for existing
    const existing = this.getByKey(layer, key);
    if (existing) {
      return this.update(existing.id, { value, tags: options.tags, metadata: options.metadata });
    }
    return this.store(layer, key, value, options);
  }

  // ── Retrieve ───────────────────────────────────────────────

  /**
   * Get a memory by ID
   */
  getById(id: string): MemoryEntry | undefined {
    const row = queryOne<{
      id: string; layer: string; key: string; value: string;
      metadata: string | null; tags: string; created_at: string;
      updated_at: string; expires_at: string | null;
    }>(`SELECT * FROM memory WHERE id = ?`, id);

    return row ? this.rowToEntry(row) : undefined;
  }

  /**
   * Get a memory by layer + key
   */
  getByKey(layer: MemoryLayer, key: string): MemoryEntry | undefined {
    const row = queryOne<{
      id: string; layer: string; key: string; value: string;
      metadata: string | null; tags: string; created_at: string;
      updated_at: string; expires_at: string | null;
    }>(`SELECT * FROM memory WHERE layer = ? AND key = ?`, layer, key);

    return row ? this.rowToEntry(row) : undefined;
  }

  /**
   * Get all memories in a layer
   */
  getByLayer(layer: MemoryLayer, limit: number = 100): MemoryEntry[] {
    const rows = queryAll<{
      id: string; layer: string; key: string; value: string;
      metadata: string | null; tags: string; created_at: string;
      updated_at: string; expires_at: string | null;
    }>(
      `SELECT * FROM memory WHERE layer = ? ORDER BY updated_at DESC LIMIT ?`,
      layer,
      limit,
    );

    return rows.map((r) => this.rowToEntry(r));
  }

  /**
   * Get all active (non-expired) memories
   */
  getActive(limit: number = 200): MemoryEntry[] {
    const now = new Date().toISOString();
    const rows = queryAll<{
      id: string; layer: string; key: string; value: string;
      metadata: string | null; tags: string; created_at: string;
      updated_at: string; expires_at: string | null;
    }>(
      `SELECT * FROM memory WHERE expires_at IS NULL OR expires_at > ? ORDER BY updated_at DESC LIMIT ?`,
      now,
      limit,
    );

    return rows.map((r) => this.rowToEntry(r));
  }

  // ── Search ─────────────────────────────────────────────────

  /**
   * Search memories across all layers by text content
   */
  search(query: string, options: {
    layers?: MemoryLayer[];
    tags?: string[];
    limit?: number;
  } = {}): MemoryEntry[] {
    let sql = `SELECT * FROM memory WHERE 1=1`;
    const params: unknown[] = [];

    // Text search across key, value, and tags
    sql += ` AND (key LIKE ? OR value LIKE ? OR tags LIKE ?)`;
    const searchTerm = `%${query}%`;
    params.push(searchTerm, searchTerm, searchTerm);

    if (options.layers?.length) {
      sql += ` AND layer IN (${options.layers.map(() => "?").join(",")})`;
      params.push(...options.layers);
    }

    if (options.tags?.length) {
      for (const tag of options.tags) {
        sql += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }

    sql += ` ORDER BY updated_at DESC`;
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = queryAll<{
      id: string; layer: string; key: string; value: string;
      metadata: string | null; tags: string; created_at: string;
      updated_at: string; expires_at: string | null;
    }>(sql, ...params);

    return rows.map((r) => this.rowToEntry(r));
  }

  // ── Update ─────────────────────────────────────────────────

  /**
   * Update a memory entry
   */
  update(id: string, patch: Partial<Pick<MemoryEntry, "value" | "tags" | "metadata">>): MemoryEntry | null {
    const existing = this.getById(id);
    if (!existing) return null;

    // Privacy check on new value
    if (patch.value && containsSensitiveData(patch.value)) {
      console.warn(`[memory] Blocked updating with sensitive data (id: ${id})`);
      return null;
    }

    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];

    if (patch.value !== undefined) {
      sets.push("value = ?");
      params.push(patch.value);
    }
    if (patch.tags !== undefined) {
      sets.push("tags = ?");
      params.push(JSON.stringify(patch.tags));
    }
    if (patch.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(patch.metadata ? JSON.stringify(patch.metadata) : null);
    }

    params.push(id);
    run(`UPDATE memory SET ${sets.join(", ")} WHERE id = ?`, ...params);

    eventBus.emit("memory.stored", "memory", { id, updated: true });
    return this.getById(id)!;
  }

  // ── Delete ─────────────────────────────────────────────────

  /**
   * Delete a memory by ID
   */
  delete(id: string): boolean {
    const existing = this.getById(id);
    if (!existing) return false;

    run(`DELETE FROM memory WHERE id = ?`, id);
    eventBus.emit("memory.deleted", "memory", { id, key: existing.key, layer: existing.layer });
    return true;
  }

  /**
   * Delete all memories in a layer
   */
  clearLayer(layer: MemoryLayer): number {
    const result = run(`DELETE FROM memory WHERE layer = ?`, layer);
    eventBus.emit("memory.deleted", "memory", { layer, count: result.changes });
    return result.changes;
  }

  /**
   * Forget: delete by key pattern
   */
  forget(pattern: string): number {
    const result = run(`DELETE FROM memory WHERE key LIKE ? OR value LIKE ?`, `%${pattern}%`, `%${pattern}%`);
    eventBus.emit("memory.deleted", "memory", { pattern, count: result.changes });
    return result.changes;
  }

  // ── Cleanup ────────────────────────────────────────────────

  /**
   * Remove expired memories
   */
  prune(): number {
    const now = new Date().toISOString();
    const result = run(`DELETE FROM memory WHERE expires_at IS NOT NULL AND expires_at < ?`, now);
    if (result.changes > 0) {
      console.log(`[memory] Pruned ${result.changes} expired entries`);
    }
    return result.changes;
  }

  // ── Stats ──────────────────────────────────────────────────

  /**
   * Get memory statistics
   */
  getStats(): {
    total: number;
    byLayer: Record<MemoryLayer, number>;
    active: number;
    expired: number;
  } {
    const total = (queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM memory`))?.count || 0;

    const byLayerRows = queryAll<{ layer: string; count: number }>(
      `SELECT layer, COUNT(*) as count FROM memory GROUP BY layer`
    );
    const byLayer: Record<string, number> = {};
    for (const r of byLayerRows) {
      byLayer[r.layer] = r.count;
    }

    const now = new Date().toISOString();
    const active = (queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM memory WHERE expires_at IS NULL OR expires_at > ?`, now
    ))?.count || 0;

    return {
      total,
      byLayer: byLayer as Record<MemoryLayer, number>,
      active,
      expired: total - active,
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private getDefaultExpiry(layer: MemoryLayer): string | null {
    switch (layer) {
      case "short_term": return new Date(Date.now() + 30 * 60000).toISOString();     // 30 min
      case "working":    return new Date(Date.now() + 4 * 3600000).toISOString();     // 4 hours
      case "long_term":  return null;                                                    // never expires
      case "episodic":   return null;                                                    // never expires
    }
  }

  private rowToEntry(row: {
    id: string; layer: string; key: string; value: string;
    metadata: string | null; tags: string; created_at: string;
    updated_at: string; expires_at: string | null;
  }): MemoryEntry {
    return {
      id: row.id,
      layer: row.layer as MemoryLayer,
      key: row.key,
      value: row.value,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at || undefined,
      tags: JSON.parse(row.tags),
    };
  }
}

export const memory = new MemoryManager();
