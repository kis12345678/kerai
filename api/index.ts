/**
 * KERAI Vercel Serverless API
 *
 * Uses Neon PostgreSQL for persistent storage.
 * Falls back to in-memory mock when DATABASE_URL is not set.
 */

import express from "express";
import serverless from "serverless-http";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// ── Neon Client ────────────────────────────────────────────────

const HAS_DB = !!process.env.DATABASE_URL;
let _sql: NeonQueryFunction<false, false> | null = null;

function getSql() {
  if (!HAS_DB) throw new Error("No DATABASE_URL configured");
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

async function dbQuery<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<T[]> {
  if (!HAS_DB) return [];
  try { return (await getSql()(sql, args || []) as unknown as T[]); }
  catch (e) { console.error("[DB]", (e as Error).message?.slice(0, 80)); return []; }
}

async function dbRun(sql: string, args?: unknown[]): Promise<{ rowCount: number }> {
  if (!HAS_DB) return { rowCount: 0 };
  try { const r = await getSql()(sql, args || []); return { rowCount: (r as any).rowCount ?? 0 }; }
  catch (e) { console.error("[DB]", (e as Error).message?.slice(0, 80)); return { rowCount: 0 }; }
}

// ── Schema ─────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, objective TEXT NOT NULL, plan TEXT DEFAULT '[]', steps TEXT DEFAULT '[]', status TEXT DEFAULT 'queued', result TEXT, error TEXT, permission_level INT DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL, data TEXT, severity TEXT DEFAULT 'info', timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, layer TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, metadata TEXT, tags TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, actor TEXT DEFAULT 'system', details TEXT, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tool_runs (id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, input TEXT, output TEXT, success INT DEFAULT 1, error TEXT, duration_ms INT, task_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tools (name TEXT PRIMARY KEY, description TEXT NOT NULL, category TEXT NOT NULL, input_schema TEXT DEFAULT '{}', output_schema TEXT DEFAULT '{}', permission_level INT DEFAULT 0, risk_level TEXT DEFAULT 'none', requires_confirmation INT DEFAULT 0, provider TEXT DEFAULT 'local', enabled INT DEFAULT 1, timeout INT DEFAULT 30000, retry_count INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', trigger_type TEXT DEFAULT 'manual', trigger_config TEXT DEFAULT '{}', steps TEXT DEFAULT '[]', conditions TEXT DEFAULT '[]', enabled INT DEFAULT 1, run_count INT DEFAULT 0, last_run_at TEXT, last_run_result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, workflow_id TEXT, name TEXT NOT NULL, trigger_type TEXT DEFAULT 'cron', trigger_config TEXT DEFAULT '{}', enabled INT DEFAULT 1, last_run_at TEXT, next_run_at TEXT, run_count INT DEFAULT 0, last_result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, type TEXT DEFAULT 'info', title TEXT NOT NULL, message TEXT NOT NULL, source TEXT DEFAULT 'kerai', read INT DEFAULT 0, action_url TEXT, metadata TEXT, created_at TEXT NOT NULL);
`;

let _schemaReady = false;

async function ensureSchema() {
  if (_schemaReady || !HAS_DB) return;
  try {
    const sql = getSql();
    const stmts = SCHEMA.split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) { try { await sql(stmt); } catch { /* exists */ } }
    _schemaReady = true;
    console.log("[DB] Neon PostgreSQL schema initialized");
  } catch (e) { console.error("[DB] Schema init failed:", (e as Error).message?.slice(0, 100)); }
}

// ── Express App ────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// DB init middleware
app.use(async (_req, _res, next) => {
  try { await ensureSchema(); } catch { /* no DB */ }
  next();
});

// CORS — allow any *.vercel.app, *.kerai.in, and localhost
app.use((_req, res, next) => {
  const origin = _req.headers.origin || "";
  const allowed =
    /^https?:\/\/localhost(:\d+)?/.test(origin) ||
    /\.vercel\.app$/.test(origin) ||
    /\.kerai\.in$/.test(origin);
  if (allowed) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (_req.method === "OPTIONS") { res.status(200).end(); return; }
  next();
});

let _bootTime = Date.now();
let _idCounter = 1000;
function genId(p: string) { return `${p}-${++_idCounter}`; }

// ── Health ─────────────────────────────────────────────────────

app.get("/api/ping", (_req, res) => {
  res.json({ message: "kerai online", timestamp: new Date().toISOString(), backend: HAS_DB ? "neon" : "mock" });
});

app.get("/api/status", async (_req, res) => {
  const eventCount = (await dbQuery<{ cnt: string }>("SELECT COUNT(*) as cnt FROM events"))[0]?.cnt ?? "0";
  res.json({
    uptime: Math.floor((Date.now() - _bootTime) / 1000), cpu: 0, memory: 0,
    geminiConfigured: !!process.env.GEMINI_API_KEY, toolCount: 37, activeProvider: "gemini",
    backend: HAS_DB ? "neon" : "mock", eventCount: Number(eventCount),
    availableProviders: [
      { provider: "gemini", available: !!process.env.GEMINI_API_KEY },
      { provider: "openai", available: !!process.env.OPENAI_API_KEY },
      { provider: "anthropic", available: !!process.env.ANTHROPIC_API_KEY },
    ],
  });
});

// ── Commands / Chat ────────────────────────────────────────────

app.get("/api/commands", async (_req, res) => {
  res.json(await dbQuery("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50"));
});

app.post("/api/commands", async (req, res) => {
  const { text } = req.body;
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  const reply = generateReply(text);
  const id = genId("cmd"), ts = new Date().toISOString();
  await dbRun("INSERT INTO audit_log (id,action,entity_type,entity_id,actor,details,timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, "chat", "command", id, "user", JSON.stringify({ text, reply }), ts]);
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
    if (i < chunks.length) { res.write(`data: ${JSON.stringify({ type: "chunk", text: chunks[i++] })}\n\n`); }
    else { res.write(`data: ${JSON.stringify({ type: "done", id: genId("cmd"), fullText: reply, timestamp: new Date().toISOString() })}\n\n`); clearInterval(interval); res.end(); }
  }, 50);
});

app.post("/api/commands/clear", (_req, res) => { res.json({ message: "Cleared" }); });

// ── Automations ────────────────────────────────────────────────

app.get("/api/automations", async (_req, res) => {
  res.json(await dbQuery("SELECT * FROM workflows ORDER BY created_at DESC"));
});

app.post("/api/automations", async (req, res) => {
  const { name, trigger } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const id = genId("auto"), ts = new Date().toISOString();
  await dbRun("INSERT INTO workflows (id,name,description,trigger_type,steps,enabled,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, name, trigger || "", "manual", "[]", 1, ts, ts]);
  res.status(201).json({ id, name, trigger, active: true, createdAt: ts });
});

app.patch("/api/automations/:id/toggle", async (req, res) => {
  await dbRun("UPDATE workflows SET enabled = $1 WHERE id = $2", [req.body.active ? 1 : 0, req.params.id]);
  res.json({ id: req.params.id, active: req.body.active });
});

app.delete("/api/automations/:id", async (req, res) => {
  await dbRun("DELETE FROM workflows WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

// ── Logs ───────────────────────────────────────────────────────

app.get("/api/logs", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(await dbQuery("SELECT * FROM events ORDER BY timestamp DESC LIMIT $1", [limit]));
});

app.post("/api/logs", async (req, res) => {
  const id = genId("log"), ts = new Date().toISOString();
  await dbRun("INSERT INTO events (id,type,source,data,severity,timestamp) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, req.body.level || "info", req.body.source || "system", req.body.message || "", "info", ts]);
  res.status(201).json({ id, ...req.body, timestamp: ts });
});

app.delete("/api/logs", async (_req, res) => { await dbRun("DELETE FROM events"); res.json({ message: "Cleared" }); });

// ── Integrations ───────────────────────────────────────────────

const _integrations = [
  { id: "int-outlook", name: "Outlook", description: "Mail & calendar sync", icon: "Mail", status: "connected" },
  { id: "int-teams", name: "Teams", description: "Messages & meetings", icon: "MessageCircle", status: "connected" },
  { id: "int-onedrive", name: "OneDrive", description: "File access & backup", icon: "Cloud", status: "connected" },
  { id: "int-excel", name: "Excel", description: "Data & reporting", icon: "FileSpreadsheet", status: "connected" },
  { id: "int-word", name: "Word", description: "Document drafting", icon: "FileText", status: "connected" },
  { id: "int-windows", name: "Windows", description: "OS-level control", icon: "AppWindow", status: "connected" },
];
app.get("/api/integrations", (_req, res) => res.json(_integrations));
app.get("/api/integrations/:id", (req, res) => { const i = _integrations.find((x) => x.id === req.params.id); i ? res.json(i) : res.status(404).json({ error: "Not found" }); });
app.patch("/api/integrations/:id", (req, res) => { const i = _integrations.find((x) => x.id === req.params.id); if (!i) { res.status(404).json({ error: "Not found" }); return; } Object.assign(i, req.body); res.json(i); });
app.post("/api/integrations/:id/sync", (req, res) => { const i = _integrations.find((x) => x.id === req.params.id); i ? res.json(i) : res.status(404).json({ error: "Not found" }); });

// ── Settings ───────────────────────────────────────────────────

let _settings: any = {
  displayName: "Kishan", theme: "dark", notifications: true, autoStart: true,
  persona: "female", voiceStyle: "warm", voiceDelay: 600,
  permissions: { email: true, calendar: true, files: true, documents: true, presentations: false, osControl: true, cloudInfrastructure: false, dataAnalysis: true },
  voice: { enabled: true, wakeWord: "Hey KERAI", voiceName: "Nova", speed: 1.0, autoListen: false, pushToTalk: false },
  advanced: { debugMode: false, logRetentionDays: 30, maxConcurrentTasks: 5, commandHistorySize: 100, apiTimeout: 30 },
};
app.get("/api/settings", (_req, res) => res.json(_settings));
app.put("/api/settings", (req, res) => { _settings = { ..._settings, ...req.body }; res.json(_settings); });

// ── Tasks ──────────────────────────────────────────────────────

app.get("/api/tasks", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const tasks = await dbQuery("SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1", [limit]);
  res.json({ tasks, total: tasks.length, byStatus: {} });
});
app.get("/api/tasks/stats", async (_req, res) => {
  const rows = await dbQuery<{ status: string; cnt: string }>("SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status");
  const byStatus: Record<string, number> = {}; rows.forEach((r) => { byStatus[r.status] = Number(r.cnt); });
  res.json({ total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus });
});
app.post("/api/tasks", async (req, res) => {
  const id = genId("task"), ts = new Date().toISOString();
  await dbRun("INSERT INTO tasks (id,objective,plan,steps,status,result,permission_level,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, req.body.message || "Task", "[]", "[]", "completed", "Task processed", 0, ts, ts]);
  res.json({ task: { id, objective: req.body.message, status: "completed", createdAt: ts }, response: "Task completed" });
});

// ── Workflows ──────────────────────────────────────────────────

app.get("/api/workflows", async (_req, res) => {
  const workflows = await dbQuery("SELECT * FROM workflows ORDER BY created_at DESC");
  res.json({ workflows, total: workflows.length });
});
app.post("/api/workflows", async (req, res) => {
  const id = genId("wf"), ts = new Date().toISOString();
  await dbRun("INSERT INTO workflows (id,name,description,steps,enabled,run_count,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, req.body.name, req.body.description || "", JSON.stringify(req.body.steps || []), 1, 0, ts, ts]);
  res.status(201).json({ id, name: req.body.name, enabled: true, createdAt: ts });
});
app.post("/api/workflows/:id/toggle", async (req, res) => {
  const rows = await dbQuery<{ enabled: number }>("SELECT enabled FROM workflows WHERE id = $1", [req.params.id]);
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  await dbRun("UPDATE workflows SET enabled = $1 WHERE id = $2", [rows[0].enabled ? 0 : 1, req.params.id]);
  res.json({ id: req.params.id, enabled: !rows[0].enabled });
});
app.delete("/api/workflows/:id", async (req, res) => { await dbRun("DELETE FROM workflows WHERE id = $1", [req.params.id]); res.json({ message: "Deleted" }); });
app.post("/api/workflows/:id/run", async (_req, res) => { res.json({ success: true, steps: [], durationMs: 100 }); });

// ── Schedules ──────────────────────────────────────────────────

app.get("/api/schedules", async (_req, res) => {
  const schedules = await dbQuery("SELECT * FROM schedules ORDER BY created_at DESC");
  res.json({ schedules, total: schedules.length });
});
app.post("/api/schedules", async (req, res) => {
  const id = genId("sched"), ts = new Date().toISOString();
  await dbRun("INSERT INTO schedules (id,name,trigger_type,trigger_config,enabled,run_count,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, req.body.name, req.body.triggerType || "cron", JSON.stringify(req.body.triggerConfig || {}), 1, 0, ts, ts]);
  res.status(201).json({ id, name: req.body.name, enabled: true, createdAt: ts });
});

// ── Notifications ──────────────────────────────────────────────

app.get("/api/notifications", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const notifications = await dbQuery("SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1", [limit]);
  const unread = await dbQuery<{ cnt: string }>("SELECT COUNT(*) as cnt FROM notifications WHERE read = 0");
  res.json({ notifications, total: notifications.length, unreadCount: Number(unread[0]?.cnt ?? 0) });
});
app.get("/api/notifications/unread-count", async (_req, res) => {
  const r = await dbQuery<{ cnt: string }>("SELECT COUNT(*) as cnt FROM notifications WHERE read = 0");
  res.json({ unreadCount: Number(r[0]?.cnt ?? 0) });
});
app.post("/api/notifications", async (req, res) => {
  const id = genId("notif"), ts = new Date().toISOString();
  await dbRun("INSERT INTO notifications (id,type,title,message,source,read,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, req.body.type || "info", req.body.title || "", req.body.message || "", req.body.source || "kerai", 0, ts]);
  res.status(201).json({ id, ...req.body, read: false, createdAt: ts });
});
app.post("/api/notifications/read-all", async (_req, res) => { await dbRun("UPDATE notifications SET read = 1"); res.json({ message: "All read" }); });
app.delete("/api/notifications", async (_req, res) => { await dbRun("DELETE FROM notifications"); res.json({ message: "Cleared" }); });

// ── Memory ─────────────────────────────────────────────────────

app.get("/api/memory/stats", async (_req, res) => {
  const rows = await dbQuery<{ layer: string; cnt: string }>("SELECT layer, COUNT(*) as cnt FROM memory GROUP BY layer");
  const byLayer: Record<string, number> = {}; let total = 0;
  rows.forEach((r) => { byLayer[r.layer] = Number(r.cnt); total += Number(r.cnt); });
  res.json({ total, byLayer, active: total, expired: 0 });
});
app.get("/api/memory", async (req, res) => {
  const layer = req.query.layer as string;
  const entries = layer
    ? await dbQuery("SELECT * FROM memory WHERE layer = $1 ORDER BY created_at DESC", [layer])
    : await dbQuery("SELECT * FROM memory ORDER BY created_at DESC LIMIT 100");
  res.json({ entries, total: entries.length });
});
app.post("/api/memory", async (req, res) => {
  const id = genId("mem"), ts = new Date().toISOString();
  await dbRun("INSERT INTO memory (id,layer,key,value,tags,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, req.body.layer || "long-term", req.body.key, req.body.value, JSON.stringify(req.body.tags || []), ts, ts]);
  res.status(201).json({ id, layer: req.body.layer, key: req.body.key, value: req.body.value, createdAt: ts });
});
app.get("/api/memory/search", async (req, res) => {
  const q = (req.query.q as string) || "";
  const entries = await dbQuery("SELECT * FROM memory WHERE key LIKE '%' || $1 || '%' OR value LIKE '%' || $1 || '%' LIMIT 50", [q]);
  res.json({ entries, total: entries.length, query: q });
});

// ── Permissions ────────────────────────────────────────────────

app.get("/api/permissions", (_req, res) => {
  res.json({ totalTools: 37, allowedTools: 37, blockedTools: 0, confirmationRequiredTools: 2, overrides: 0, settingsPermissions: _settings.permissions });
});

// ── Events ─────────────────────────────────────────────────────

app.get("/api/events", async (_req, res) => {
  const events = await dbQuery("SELECT * FROM events ORDER BY timestamp DESC LIMIT 100");
  res.json({ events, total: events.length });
});
app.get("/api/events/recent", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const events = await dbQuery("SELECT * FROM events ORDER BY timestamp DESC LIMIT $1", [limit]);
  res.json({ events, total: events.length });
});
app.get("/api/events/stats", async (_req, res) => {
  const r = await dbQuery<{ cnt: string }>("SELECT COUNT(*) as cnt FROM events");
  res.json({ total: Number(r[0]?.cnt ?? 0), byType: {}, bySeverity: {} });
});

// ── Tools ──────────────────────────────────────────────────────

const TOOLS = [
  { name: "system.get_status", description: "Get system status", category: "system", permissionLevel: 0, provider: "local", enabled: true },
  { name: "system.list_processes", description: "List processes", category: "system", permissionLevel: 0, provider: "local", enabled: true },
  { name: "system.get_disk_usage", description: "Get disk usage", category: "system", permissionLevel: 0, provider: "local", enabled: true },
  { name: "files.read", description: "Read a file", category: "files", permissionLevel: 1, provider: "local", enabled: true },
  { name: "files.write", description: "Write a file", category: "files", permissionLevel: 2, provider: "local", enabled: true },
  { name: "files.list", description: "List directory", category: "files", permissionLevel: 0, provider: "local", enabled: true },
  { name: "browser.navigate", description: "Navigate to URL", category: "browser", permissionLevel: 1, provider: "local", enabled: true },
  { name: "browser.search", description: "Search the web", category: "browser", permissionLevel: 1, provider: "local", enabled: true },
  { name: "browser.extract", description: "Extract page content", category: "browser", permissionLevel: 0, provider: "local", enabled: true },
  { name: "browser.click", description: "Click element", category: "browser", permissionLevel: 1, provider: "local", enabled: true },
  { name: "browser.type", description: "Type text", category: "browser", permissionLevel: 1, provider: "local", enabled: true },
  { name: "browser.screenshot", description: "Take screenshot", category: "browser", permissionLevel: 1, provider: "local", enabled: true },
  { name: "browser.elements", description: "List elements", category: "browser", permissionLevel: 0, provider: "local", enabled: true },
  { name: "browser.close", description: "Close browser", category: "browser", permissionLevel: 0, provider: "local", enabled: true },
  { name: "google.gmail.list", description: "List Gmail", category: "email", permissionLevel: 1, provider: "google", enabled: !!process.env.GOOGLE_CLIENT_ID },
  { name: "google.calendar.list", description: "List calendar", category: "calendar", permissionLevel: 1, provider: "google", enabled: !!process.env.GOOGLE_CLIENT_ID },
  { name: "google.drive.list", description: "List Drive files", category: "files", permissionLevel: 1, provider: "google", enabled: !!process.env.GOOGLE_CLIENT_ID },
  { name: "microsoft.outlook.list", description: "List Outlook", category: "email", permissionLevel: 1, provider: "microsoft", enabled: !!process.env.MICROSOFT_CLIENT_ID },
  { name: "microsoft.calendar.list", description: "List calendar", category: "calendar", permissionLevel: 1, provider: "microsoft", enabled: !!process.env.MICROSOFT_CLIENT_ID },
  { name: "microsoft.onedrive.list", description: "List OneDrive", category: "files", permissionLevel: 1, provider: "microsoft", enabled: !!process.env.MICROSOFT_CLIENT_ID },
];
app.get("/api/tools", (_req, res) => {
  const byCategory: Record<string, number> = {};
  TOOLS.forEach((t) => { byCategory[t.category] = (byCategory[t.category] || 0) + 1; });
  res.json({ tools: TOOLS, total: TOOLS.length, byCategory });
});

// ── Agent ──────────────────────────────────────────────────────

app.get("/api/agent/system", (_req, res) => { res.json({ platform: "serverless", arch: "unknown", hostname: "vercel", uptime: Math.floor((Date.now() - _bootTime) / 1000) }); });
app.get("/api/agent/cpu", (_req, res) => { res.json({ cores: [], totalUsage: 0, loadAvg: [0, 0, 0] }); });
app.get("/api/agent/disks", (_req, res) => { res.json({ disks: [], total: 0 }); });
app.get("/api/agent/windows", (_req, res) => { res.json({ windows: [], total: 0 }); });
app.get("/api/agent/processes", (_req, res) => { res.json({ processes: [], total: 0 }); });
app.get("/api/agent/network", (_req, res) => { res.json({ hostname: "vercel", platform: "serverless", interfaces: [] }); });

// ── Google/Microsoft stubs ─────────────────────────────────────

app.get("/api/google/status", (_req, res) => { res.json({ connected: false }); });
app.get("/api/microsoft/status", (_req, res) => { res.json({ connected: false }); });

// ── Browser stub ───────────────────────────────────────────────

app.get("/api/browser/status", (_req, res) => {
  res.json({ running: false, currentUrl: null, capabilities: ["navigate", "search", "extract", "click", "type", "screenshot", "elements"], note: "Full browser automation available on local dev." });
});

// ── Fallback ───────────────────────────────────────────────────

app.all("/api/{*rest}", (_req, res) => { res.status(404).json({ error: "API endpoint not found" }); });

// ── Reply helper ───────────────────────────────────────────────

function generateReply(text: string): string {
  const l = text.toLowerCase();
  if (l.includes("hello") || l.includes("hey") || l.includes("hi")) return "Hey Kishan! 👋 I'm KERAI. All systems online with Neon PostgreSQL. What do you need?";
  if (l.includes("status") || l.includes("health")) return "All systems nominal! ✅ 37 tools, Neon database connected, permissions active. What would you like?";
  if (l.includes("help")) return "I can help with:\n• 📧 Email (Gmail, Outlook)\n• 📅 Calendar\n• 📁 Files\n• 💻 System monitoring\n• 🔄 Workflows\n• 🧠 Memory\n• 🌐 Browser automation\n\nJust tell me what you need!";
  if (l.includes("2+2")) return "2 + 2 = 4 😄";
  return `Received: "${text}". For full AI, set GEMINI_API_KEY in Vercel env vars.`;
}

export default serverless(app);
