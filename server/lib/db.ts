/**
 * KERAI Database Layer
 *
 * Supports two backends:
 *   1. Turso (libSQL) — used when TURSO_DATABASE_URL is set (Vercel/serverless)
 *   2. Local SQLite (better-sqlite3) — used in local development
 *
 * Both expose the same interface: queryAll, queryOne, run, transaction
 */

import { createClient, type Client } from "@libsql/client";

// ── Backend detection ──────────────────────────────────────────

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const USE_TURSO = !!TURSO_URL;

// ── Schema SQL (shared) ────────────────────────────────────────

const SCHEMA_SQL = `
  -- Tasks table
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    objective TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'queued',
    result TEXT,
    error TEXT,
    permission_level INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  -- Events table
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    data TEXT,
    severity TEXT NOT NULL DEFAULT 'info',
    timestamp TEXT NOT NULL
  );

  -- Memory table (4-layer memory system)
  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    layer TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    metadata TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
  );

  -- Audit log (immutable, append-only)
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    actor TEXT NOT NULL DEFAULT 'system',
    details TEXT,
    timestamp TEXT NOT NULL
  );

  -- Tool runs
  CREATE TABLE IF NOT EXISTS tool_runs (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    input TEXT,
    output TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    duration_ms INTEGER,
    task_id TEXT,
    created_at TEXT NOT NULL
  );

  -- Tool registry
  CREATE TABLE IF NOT EXISTS tools (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    input_schema TEXT NOT NULL DEFAULT '{}',
    output_schema TEXT NOT NULL DEFAULT '{}',
    permission_level INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'none',
    requires_confirmation INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'local',
    enabled INTEGER NOT NULL DEFAULT 1,
    timeout INTEGER NOT NULL DEFAULT 30000,
    retry_count INTEGER NOT NULL DEFAULT 0
  );

  -- Workflows
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    trigger_config TEXT NOT NULL DEFAULT '{}',
    steps TEXT NOT NULL DEFAULT '[]',
    conditions TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    last_run_result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Scheduled tasks
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    workflow_id TEXT,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'cron',
    trigger_config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Notifications
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'kerai',
    read INTEGER NOT NULL DEFAULT 0,
    action_url TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  );
`;

const INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_memory_layer ON memory(layer);
  CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key);
  CREATE INDEX IF NOT EXISTS idx_tool_runs_tool ON tool_runs(tool_name);
  CREATE INDEX IF NOT EXISTS idx_tool_runs_task ON tool_runs(task_id);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);
  CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
  CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
`;

// ── Turso (libSQL) backend ─────────────────────────────────────

let tursoClient: Client | null = null;

function getTursoClient(): Client {
  if (!tursoClient) {
    tursoClient = createClient({
      url: TURSO_URL!,
      authToken: TURSO_TOKEN,
    });
  }
  return tursoClient;
}

async function initTurso(): Promise<void> {
  const client = getTursoClient();
  // Execute each statement individually (Turso doesn't support multi-statement)
  const statements = [...SCHEMA_SQL.split(";"), ...INDEX_SQL.split(";")]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sql of statements) {
    try {
      await client.execute(sql);
    } catch (e) {
      console.warn("[DB] Turso statement warning:", (e as Error).message?.slice(0, 80));
    }
  }
  console.log("[DB] Turso (libSQL) schema initialized");
}

// ── Local SQLite backend ───────────────────────────────────────

let localDb: any = null;

function getLocalDb(): any {
  if (!localDb) {
    // Dynamic import to avoid crashing when better-sqlite3 isn't needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const path = require("node:path");
    const fs = require("node:fs");

    const DB_PATH = path.resolve(import.meta.dirname || __dirname, "../../data/kerai.db");
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    localDb = new Database(DB_PATH);
    localDb.pragma("journal_mode = WAL");
    localDb.pragma("foreign_keys = ON");
  }
  return localDb;
}

function initLocal(): void {
  const db = getLocalDb();
  db.exec(SCHEMA_SQL);
  db.exec(INDEX_SQL);
  console.log("[DB] Local SQLite schema initialized");
}

// ── Unified interface ──────────────────────────────────────────

export function initDb(): void {
  if (USE_TURSO) {
    // Turso init is async but we call it and let it run
    initTurso().catch((e) => console.error("[DB] Turso init failed:", e));
  } else {
    initLocal();
  }
  console.log(`[DB] Backend: ${USE_TURSO ? "Turso (libSQL)" : "Local SQLite"}`);
}

/**
 * Run a query and return all rows
 */
export function queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  if (USE_TURSO) {
    // Turso is async, but we use a sync-compatible wrapper
    // For Turso, we return via a stored promise — callers should handle this
    // In practice, for the Vercel API routes, we use async versions
    throw new Error("queryAll is sync-only. Use queryAllAsync() for Turso.");
  }
  return getLocalDb().prepare(sql).all(...params) as T[];
}

/**
 * Run a query and return all rows (async — works with both backends)
 */
export async function queryAllAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
  if (USE_TURSO) {
    const client = getTursoClient();
    const result = await client.execute({ sql, args: params as any[] });
    return result.rows as unknown as T[];
  }
  return getLocalDb().prepare(sql).all(...params) as T[];
}

/**
 * Run a query and return first row
 */
export function queryOne<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  if (USE_TURSO) {
    throw new Error("queryOne is sync-only. Use queryOneAsync() for Turso.");
  }
  return getLocalDb().prepare(sql).get(...params) as T | undefined;
}

/**
 * Run a query and return first row (async — works with both backends)
 */
export async function queryOneAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  if (USE_TURSO) {
    const client = getTursoClient();
    const result = await client.execute({ sql, args: params as any[] });
    return result.rows[0] as unknown as T | undefined;
  }
  return getLocalDb().prepare(sql).get(...params) as T | undefined;
}

/**
 * Run a statement (INSERT, UPDATE, DELETE)
 */
export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  if (USE_TURSO) {
    throw new Error("run is sync-only. Use runAsync() for Turso.");
  }
  return getLocalDb().prepare(sql).run(...params) as any;
}

/**
 * Run a statement (async — works with both backends)
 */
export async function runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
  if (USE_TURSO) {
    const client = getTursoClient();
    const result = await client.execute({ sql, args: params as any[] });
    return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid) };
  }
  return getLocalDb().prepare(sql).run(...params) as any;
}

/**
 * Run multiple statements in a transaction (sync only, local only)
 */
export function transaction<T>(fn: () => T): T {
  if (USE_TURSO) {
    // libSQL doesn't have synchronous transactions, so we execute sequentially
    // This is a best-effort fallback
    return fn();
  }
  const t = getLocalDb().transaction(fn);
  return t();
}

/**
 * Execute multiple SQL statements in sequence (async)
 */
export async function executeBatch(sqls: string[]): Promise<void> {
  if (USE_TURSO) {
    const client = getTursoClient();
    await client.batch(sqls.map((sql) => ({ sql })));
    return;
  }
  const db = getLocalDb();
  for (const sql of sqls) {
    db.prepare(sql).run();
  }
}

// ── Default export for backward compat ─────────────────────────

export default {
  get queryAll() { return queryAll; },
  get queryOne() { return queryOne; },
  get run() { return run; },
};

export { USE_TURSO };
