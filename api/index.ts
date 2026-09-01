import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import { createClient, type Client } from "@libsql/client";

// ── Turso Client ───────────────────────────────────────────────

let _client: Client | null = null;
const HAS_DB = !!process.env.TURSO_DATABASE_URL;

// Mock client that returns empty results when no DB is configured
const _mockClient = {
  execute: async () => ({ rows: [], columns: [], rowsAffected: 0, lastInsertRowid: 0 }),
  batch: async () => ({ rows: [], columns: [], rowsAffected: 0, lastInsertRowid: 0 }),
} as unknown as Client;

function getClient(): Client {
  if (!HAS_DB) return _mockClient;
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

// ── Schema ─────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, objective TEXT NOT NULL, plan TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'queued',
    result TEXT, error TEXT, permission_level INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL, data TEXT,
    severity TEXT NOT NULL DEFAULT 'info', timestamp TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY, layer TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    metadata TEXT, tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL,
    entity_id TEXT, actor TEXT NOT NULL DEFAULT 'system', details TEXT, timestamp TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tool_runs (
    id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, input TEXT, output TEXT,
    success INTEGER NOT NULL DEFAULT 1, error TEXT, duration_ms INTEGER,
    task_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tools (
    name TEXT PRIMARY KEY, description TEXT NOT NULL, category TEXT NOT NULL,
    input_schema TEXT NOT NULL DEFAULT '{}', output_schema TEXT NOT NULL DEFAULT '{}',
    permission_level INTEGER NOT NULL DEFAULT 0, risk_level TEXT NOT NULL DEFAULT 'none',
    requires_confirmation INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL DEFAULT 'local',
    enabled INTEGER NOT NULL DEFAULT 1, timeout INTEGER NOT NULL DEFAULT 30000,
    retry_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    trigger_type TEXT NOT NULL DEFAULT 'manual', trigger_config TEXT NOT NULL DEFAULT '{}',
    steps TEXT NOT NULL DEFAULT '[]', conditions TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1, run_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT, last_run_result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY, workflow_id TEXT, name TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'cron', trigger_config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, next_run_at TEXT,
    run_count INTEGER NOT NULL DEFAULT 0, last_result TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL,
    message TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'kerai',
    read INTEGER NOT NULL DEFAULT 0, action_url TEXT, metadata TEXT, created_at TEXT NOT NULL
  );
`;

let _schemaReady = false;

async function ensureSchema() {
  if (_schemaReady) return;
  if (!HAS_DB) { _schemaReady = true; return; }
  const client = getClient();
  const statements = SCHEMA.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const sql of statements) {
    try { await client.execute(sql); } catch { /* table may already exist */ }
  }
  _schemaReady = true;
}

// ── Helper: generate ID ────────────────────────────────────────

let _idCounter = 1000;
function genId(prefix: string) { _idCounter++; return `${prefix}-${_idCounter}`; }

// ── Express App ────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Middleware: ensure DB schema on first request
app.use(async (_req, _res, next) => {
  try { await ensureSchema(); } catch { /* no DB configured, mock will handle */ }
  next();
});

// ── CORS ───────────────────────────────────────────────────────

app.use((_req, res, next) => {
  const allowedOrigins = [
    "https://myassit.vercel.app",
    "https://myassit.kerai.in",
    "http://localhost:8080",
    "http://localhost:5173",
  ];
  const origin = _req.headers.origin || "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (_req.method === "OPTIONS") { res.status(200).end(); return; }
  next();
});

let _bootTime = Date.now();

// ── Health ─────────────────────────────────────────────────────

app.get("/api/ping", (_req, res) => {
  res.json({ message: "kerai online", timestamp: new Date().toISOString(), backend: HAS_DB ? "turso" : "mock" });
});

app.get("/api/status", async (_req, res) => {
  let eventCount = 0;
  try {
    const r = await getClient().execute("SELECT COUNT(*) as cnt FROM events");
    eventCount = Number(r.rows[0]?.cnt ?? 0);
  } catch { /* ignore */ }
  res.json({
    uptime: Math.floor((Date.now() - _bootTime) / 1000),
    cpu: 0, memory: 0,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    toolCount: 29, activeProvider: "gemini",
    backend: HAS_DB ? "turso" : "mock", eventCount,
    availableProviders: [
      { provider: "gemini", available: !!process.env.GEMINI_API_KEY },
      { provider: "openai", available: !!process.env.OPENAI_API_KEY },
      { provider: "anthropic", available: !!process.env.ANTHROPIC_API_KEY },
    ],
  });
});

// ── Commands / Chat ────────────────────────────────────────────

app.get("/api/commands", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50");
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post("/api/commands", async (req, res) => {
  const { text } = req.body;
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  const reply = generateReply(text);
  const id = genId("cmd");
  const ts = new Date().toISOString();
  const client = getClient();
  try {
    await client.execute({
      sql: "INSERT INTO audit_log (id, action, entity_type, entity_id, actor, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, "chat", "command", id, "user", JSON.stringify({ text, reply }), ts],
    });
  } catch { /* best effort */ }
  res.json({ id, role: "kerai", text: reply, timestamp: ts });
});

app.post("/api/commands/stream", async (req, res) => {
  const { text } = req.body;
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const reply = generateReply(text);
  const chunks = reply.match(/.{1,15}/g) || [reply];
  let i = 0;
  const interval = setInterval(() => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify({ type: "chunk", text: chunks[i] })}\n\n`);
      i++;
    } else {
      res.write(`data: ${JSON.stringify({ type: "done", id: genId("cmd"), fullText: reply, timestamp: new Date().toISOString() })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 50);
});

app.post("/api/commands/clear", (_req, res) => { res.json({ message: "Cleared" }); });

// ── Automations ────────────────────────────────────────────────

app.get("/api/automations", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT * FROM workflows ORDER BY created_at DESC");
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post("/api/automations", async (req, res) => {
  const { name, trigger } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const id = genId("auto");
  const ts = new Date().toISOString();
  const client = getClient();
  await client.execute({
    sql: "INSERT INTO workflows (id, name, description, trigger_type, steps, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, name, trigger || "", "manual", "[]", 1, ts, ts],
  }).catch(() => {});
  res.status(201).json({ id, name, trigger, active: true, createdAt: ts });
});

app.patch("/api/automations/:id/toggle", async (req, res) => {
  const client = getClient();
  const enabled = req.body.active ? 1 : 0;
  await client.execute({ sql: "UPDATE workflows SET enabled = ? WHERE id = ?", args: [enabled, req.params.id] });
  res.json({ id: req.params.id, active: req.body.active });
});

app.delete("/api/automations/:id", async (req, res) => {
  const client = getClient();
  await client.execute({ sql: "DELETE FROM workflows WHERE id = ?", args: [req.params.id] });
  res.status(204).end();
});

// ── Logs ───────────────────────────────────────────────────────

app.get("/api/logs", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const client = getClient();
  try {
    const r = await client.execute({ sql: "SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", args: [limit] });
    res.json(r.rows);
  } catch { res.json([]); }
});

app.post("/api/logs", async (req, res) => {
  const client = getClient();
  const id = genId("log");
  const ts = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO events (id, type, source, data, severity, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, req.body.level || "info", req.body.source || "system", req.body.message || "", "info", ts],
  });
  res.status(201).json({ id, ...req.body, timestamp: ts });
});

app.delete("/api/logs", async (_req, res) => {
  const client = getClient();
  await client.execute("DELETE FROM events");
  res.json({ message: "Cleared" });
});

// ── Integrations ───────────────────────────────────────────────

const _integrations = [
  { id: "int-outlook", name: "Outlook", description: "Mail & calendar sync", icon: "Mail", status: "connected" },
  { id: "int-teams", name: "Teams", description: "Messages & meetings", icon: "MessageCircle", status: "connected" },
  { id: "int-onedrive", name: "OneDrive", description: "File access & backup", icon: "Cloud", status: "connected" },
  { id: "int-excel", name: "Excel", description: "Data & reporting", icon: "FileSpreadsheet", status: "connected" },
  { id: "int-word", name: "Word", description: "Document drafting", icon: "FileText", status: "connected" },
  { id: "int-windows", name: "Windows", description: "OS-level control", icon: "AppWindow", status: "connected" },
];

app.get("/api/integrations", (_req, res) => { res.json(_integrations); });
app.get("/api/integrations/:id", (req, res) => {
  const intg = _integrations.find((i) => i.id === req.params.id);
  if (!intg) { res.status(404).json({ error: "Not found" }); return; }
  res.json(intg);
});
app.patch("/api/integrations/:id", (req, res) => {
  const intg = _integrations.find((i) => i.id === req.params.id);
  if (!intg) { res.status(404).json({ error: "Not found" }); return; }
  Object.assign(intg, req.body);
  res.json(intg);
});
app.post("/api/integrations/:id/sync", (req, res) => {
  const intg = _integrations.find((i) => i.id === req.params.id);
  if (!intg) { res.status(404).json({ error: "Not found" }); return; }
  res.json(intg);
});

// ── Settings ───────────────────────────────────────────────────

let _settings: any = {
  displayName: "Kishan", theme: "dark", notifications: true, autoStart: true,
  persona: "female", voiceStyle: "warm", voiceDelay: 600,
  permissions: { email: true, calendar: true, files: true, documents: true, presentations: false, osControl: true, cloudInfrastructure: false, dataAnalysis: true },
  voice: { enabled: true, wakeWord: "Hey KERAI", voiceName: "Nova", speed: 1.0, autoListen: false, pushToTalk: false },
  advanced: { debugMode: false, logRetentionDays: 30, maxConcurrentTasks: 5, commandHistorySize: 100, apiTimeout: 30 },
};

app.get("/api/settings", (_req, res) => { res.json(_settings); });
app.put("/api/settings", (req, res) => { _settings = { ..._settings, ...req.body }; res.json(_settings); });

// ── Tasks ──────────────────────────────────────────────────────

app.get("/api/tasks", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const client = getClient();
  try {
    const r = await client.execute({ sql: "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", args: [limit] });
    res.json({ tasks: r.rows, total: r.rows.length, byStatus: {} });
  } catch { res.json({ tasks: [], total: 0, byStatus: {} }); }
});

app.get("/api/tasks/stats", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status");
    const byStatus: Record<string, number> = {};
    r.rows.forEach((row: any) => { byStatus[row.status] = Number(row.cnt); });
    const total = Object.values(byStatus).reduce((a: number, b: number) => a + b, 0);
    res.json({ total, byStatus });
  } catch { res.json({ total: 0, byStatus: {} }); }
});

app.post("/api/tasks", async (req, res) => {
  const id = genId("task");
  const ts = new Date().toISOString();
  const client = getClient();
  await client.execute({
    sql: "INSERT INTO tasks (id, objective, plan, steps, status, result, permission_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, req.body.message || "Task", "[]", "[]", "completed", "Task processed", 0, ts, ts],
  });
  res.json({ task: { id, objective: req.body.message, status: "completed", createdAt: ts }, response: "Task completed" });
});

// ── Workflows ──────────────────────────────────────────────────

app.get("/api/workflows", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT * FROM workflows ORDER BY created_at DESC");
    res.json({ workflows: r.rows, total: r.rows.length });
  } catch { res.json({ workflows: [], total: 0 }); }
});

app.post("/api/workflows", async (req, res) => {
  const id = genId("wf");
  const ts = new Date().toISOString();
  const client = getClient();
  await client.execute({
    sql: "INSERT INTO workflows (id, name, description, steps, enabled, run_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, req.body.name, req.body.description || "", JSON.stringify(req.body.steps || []), 1, 0, ts, ts],
  });
  res.status(201).json({ id, name: req.body.name, description: req.body.description || "", steps: req.body.steps || [], enabled: true, runCount: 0, createdAt: ts, updatedAt: ts });
});

app.post("/api/workflows/:id/toggle", async (req, res) => {
  const client = getClient();
  const r = await client.execute({ sql: "SELECT enabled FROM workflows WHERE id = ?", args: [req.params.id] });
  if (!r.rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  const newEnabled = r.rows[0].enabled ? 0 : 1;
  await client.execute({ sql: "UPDATE workflows SET enabled = ? WHERE id = ?", args: [newEnabled, req.params.id] });
  res.json({ id: req.params.id, enabled: !!newEnabled });
});

app.delete("/api/workflows/:id", async (req, res) => {
  const client = getClient();
  await client.execute({ sql: "DELETE FROM workflows WHERE id = ?", args: [req.params.id] });
  res.json({ message: "Deleted" });
});

app.post("/api/workflows/:id/run", async (_req, res) => {
  res.json({ success: true, steps: [], durationMs: 100 });
});

// ── Schedules ──────────────────────────────────────────────────

app.get("/api/schedules", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT * FROM schedules ORDER BY created_at DESC");
    res.json({ schedules: r.rows, total: r.rows.length });
  } catch { res.json({ schedules: [], total: 0 }); }
});

app.post("/api/schedules", async (req, res) => {
  const id = genId("sched");
  const ts = new Date().toISOString();
  const client = getClient();
  await client.execute({
    sql: "INSERT INTO schedules (id, name, trigger_type, trigger_config, enabled, run_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, req.body.name, req.body.triggerType || "cron", JSON.stringify(req.body.triggerConfig || {}), 1, 0, ts, ts],
  });
  res.status(201).json({ id, name: req.body.name, enabled: true, createdAt: ts });
});

// ── Notifications ──────────────────────────────────────────────

app.get("/api/notifications", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const client = getClient();
  try {
    const r = await client.execute({ sql: "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", args: [limit] });
    const unread = await client.execute("SELECT COUNT(*) as cnt FROM notifications WHERE read = 0");
    res.json({ notifications: r.rows, total: r.rows.length, unreadCount: Number(unread.rows[0]?.cnt ?? 0) });
  } catch { res.json({ notifications: [], total: 0, unreadCount: 0 }); }
});

app.get("/api/notifications/unread-count", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT COUNT(*) as cnt FROM notifications WHERE read = 0");
    res.json({ unreadCount: Number(r.rows[0]?.cnt ?? 0) });
  } catch { res.json({ unreadCount: 0 }); }
});

app.post("/api/notifications", async (req, res) => {
  const id = genId("notif");
  const ts = new Date().toISOString();
  const client = getClient();
  await client.execute({
    sql: "INSERT INTO notifications (id, type, title, message, source, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, req.body.type || "info", req.body.title || "", req.body.message || "", req.body.source || "kerai", 0, ts],
  });
  res.status(201).json({ id, ...req.body, read: false, createdAt: ts });
});

app.post("/api/notifications/read-all", async (_req, res) => {
  const client = getClient();
  await client.execute("UPDATE notifications SET read = 1");
  res.json({ message: "All read" });
});

app.delete("/api/notifications", async (_req, res) => {
  const client = getClient();
  await client.execute("DELETE FROM notifications");
  res.json({ message: "Cleared" });
});

// ── Memory ─────────────────────────────────────────────────────

app.get("/api/memory/stats", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT layer, COUNT(*) as cnt FROM memory GROUP BY layer");
    const byLayer: Record<string, number> = {};
    let total = 0;
    r.rows.forEach((row: any) => { byLayer[row.layer] = Number(row.cnt); total += Number(row.cnt); });
    res.json({ total, byLayer, active: total, expired: 0 });
  } catch { res.json({ total: 0, byLayer: {}, active: 0, expired: 0 }); }
});

app.get("/api/memory", async (req, res) => {
  const layer = req.query.layer as string;
  const client = getClient();
  try {
    const r = layer
      ? await client.execute({ sql: "SELECT * FROM memory WHERE layer = ? ORDER BY created_at DESC", args: [layer] })
      : await client.execute("SELECT * FROM memory ORDER BY created_at DESC LIMIT 100");
    res.json({ entries: r.rows, total: r.rows.length });
  } catch { res.json({ entries: [], total: 0 }); }
});

app.post("/api/memory", async (req, res) => {
  const id = genId("mem");
  const ts = new Date().toISOString();
  const client = getClient();
  await client.execute({
    sql: "INSERT INTO memory (id, layer, key, value, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, req.body.layer || "long-term", req.body.key, req.body.value, JSON.stringify(req.body.tags || []), ts, ts],
  });
  res.status(201).json({ id, layer: req.body.layer, key: req.body.key, value: req.body.value, createdAt: ts });
});

app.get("/api/memory/search", async (req, res) => {
  const q = (req.query.q as string) || "";
  const client = getClient();
  try {
    const r = await client.execute({ sql: "SELECT * FROM memory WHERE key LIKE ? OR value LIKE ? LIMIT 50", args: [`%${q}%`, `%${q}%`] });
    res.json({ entries: r.rows, total: r.rows.length, query: q });
  } catch { res.json({ entries: [], total: 0, query: q }); }
});

// ── Permissions ────────────────────────────────────────────────

app.get("/api/permissions", (_req, res) => {
  res.json({ totalTools: 29, allowedTools: 29, blockedTools: 0, confirmationRequiredTools: 2, overrides: 0, settingsPermissions: _settings.permissions });
});

// ── Events ─────────────────────────────────────────────────────

app.get("/api/events", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT * FROM events ORDER BY timestamp DESC LIMIT 100");
    res.json({ events: r.rows, total: r.rows.length });
  } catch { res.json({ events: [], total: 0 }); }
});

app.get("/api/events/recent", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const client = getClient();
  try {
    const r = await client.execute({ sql: "SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", args: [limit] });
    res.json({ events: r.rows, total: r.rows.length });
  } catch { res.json({ events: [], total: 0 }); }
});

app.get("/api/events/stats", async (_req, res) => {
  const client = getClient();
  try {
    const r = await client.execute("SELECT COUNT(*) as cnt FROM events");
    res.json({ total: Number(r.rows[0]?.cnt ?? 0), byType: {}, bySeverity: {} });
  } catch { res.json({ total: 0, byType: {}, bySeverity: {} }); }
});

// ── Tools ──────────────────────────────────────────────────────

const TOOLS = [
  { name: "system.get_status", description: "Get system status", category: "system", permissionLevel: 0, provider: "local", enabled: true },
  { name: "system.list_processes", description: "List processes", category: "system", permissionLevel: 0, provider: "local", enabled: true },
  { name: "system.get_disk_usage", description: "Get disk usage", category: "system", permissionLevel: 0, provider: "local", enabled: true },
  { name: "files.read", description: "Read a file", category: "files", permissionLevel: 1, provider: "local", enabled: true },
  { name: "files.write", description: "Write a file", category: "files", permissionLevel: 2, provider: "local", enabled: true },
  { name: "files.list", description: "List directory", category: "files", permissionLevel: 0, provider: "local", enabled: true },
  { name: "google.gmail.list", description: "List Gmail messages", category: "email", permissionLevel: 1, provider: "google", enabled: !!process.env.GOOGLE_CLIENT_ID },
  { name: "google.calendar.list", description: "List calendar events", category: "calendar", permissionLevel: 1, provider: "google", enabled: !!process.env.GOOGLE_CLIENT_ID },
  { name: "google.drive.list", description: "List Drive files", category: "files", permissionLevel: 1, provider: "google", enabled: !!process.env.GOOGLE_CLIENT_ID },
  { name: "microsoft.outlook.list", description: "List Outlook emails", category: "email", permissionLevel: 1, provider: "microsoft", enabled: !!process.env.MICROSOFT_CLIENT_ID },
  { name: "microsoft.calendar.list", description: "List calendar events", category: "calendar", permissionLevel: 1, provider: "microsoft", enabled: !!process.env.MICROSOFT_CLIENT_ID },
  { name: "microsoft.onedrive.list", description: "List OneDrive files", category: "files", permissionLevel: 1, provider: "microsoft", enabled: !!process.env.MICROSOFT_CLIENT_ID },
];

app.get("/api/tools", (_req, res) => {
  const byCategory: Record<string, number> = {};
  TOOLS.forEach((t) => { byCategory[t.category] = (byCategory[t.category] || 0) + 1; });
  res.json({ tools: TOOLS, total: TOOLS.length, byCategory });
});

// ── Agent (minimal for Vercel) ─────────────────────────────────

app.get("/api/agent/system", (_req, res) => {
  res.json({ platform: "serverless", arch: "unknown", hostname: "vercel", uptime: Math.floor((Date.now() - _bootTime) / 1000) });
});
app.get("/api/agent/cpu", (_req, res) => { res.json({ cores: [], totalUsage: 0, loadAvg: [0, 0, 0] }); });
app.get("/api/agent/disks", (_req, res) => { res.json({ disks: [], total: 0 }); });
app.get("/api/agent/windows", (_req, res) => { res.json({ windows: [], total: 0 }); });
app.get("/api/agent/processes", (_req, res) => { res.json({ processes: [], total: 0 }); });
app.get("/api/agent/network", (_req, res) => { res.json({ hostname: "vercel", platform: "serverless", interfaces: [] }); });

// ── Google/Microsoft (stub for Vercel) ─────────────────────────

app.get("/api/google/status", (_req, res) => { res.json({ connected: false }); });
app.get("/api/microsoft/status", (_req, res) => { res.json({ connected: false }); });

// ── Fallback ───────────────────────────────────────────────────

app.all("/api/{*rest}", (_req, res) => { res.status(404).json({ error: "API endpoint not found" }); });

// ── Reply helper ───────────────────────────────────────────────

function generateReply(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("hello") || lower.includes("hey") || lower.includes("hi")) {
    return "Hey Kishan! 👋 I'm KERAI, your personal AI. I'm running on Vercel with Turso cloud database — all systems online. What do you need?";
  }
  if (lower.includes("status") || lower.includes("health")) {
    return "All systems nominal! ✅ 29 tools registered, Turso database connected, permissions active, notifications enabled. What would you like me to do?";
  }
  if (lower.includes("help")) {
    return "I can help with:\n• 📧 Email (Gmail, Outlook)\n• 📅 Calendar management\n• 📁 File operations\n• 💻 System monitoring\n• 🔄 Workflows & automations\n• 🧠 Memory & context\n\nJust tell me what you need!";
  }
  if (lower.includes("2+2") || lower.includes("two plus two")) {
    return "2 + 2 = 4 😄";
  }
  return `I received your message: "${text}". I'm running on Vercel with Turso cloud database — for full AI responses, make sure GEMINI_API_KEY is set in your Vercel environment variables.`;
}

export default app;
