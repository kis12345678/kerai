import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo.js";
import { handleCommandPost, handleCommandGet, handleCommandClear, handleCommandStream } from "./routes/commands.js";
import {
  handleAutomationsList,
  handleAutomationsCreate,
  handleAutomationsToggle,
  handleAutomationsDelete,
} from "./routes/automations.js";
import { handleLogsList, handleLogsCreate, handleLogsClear } from "./routes/logs.js";
import {
  handleIntegrationsList,
  handleIntegrationsGet,
  handleIntegrationsUpdate,
  handleIntegrationsSync,
} from "./routes/integrations.js";
import { handleSettingsGet, handleSettingsUpdate } from "./routes/settings.js";
import { handleTTS } from "./routes/tts.js";
import { store } from "./store.js";
import { handleToolsList, handleToolsGet, handleToolsExecute, handleToolsToggle, handleToolsRuns } from "./routes/tools.js";
import { handleEventsList, handleEventsRecent, handleEventsStats } from "./routes/events.js";
import { handleTasksExecute, handleTasksList, handleTasksGet, handleTasksCancel, handleTasksStats } from "./routes/tasks.js";
import { handlePermissionsStatus, handlePermissionsCheck, handlePermissionsOverride, handlePermissionsClearOverride, handlePermissionsOverrides, handlePermissionsAudit } from "./routes/permissions.js";
import { handleMemoryStore, handleMemoryUpsert, handleMemoryList, handleMemorySearch, handleMemoryGet, handleMemoryUpdate, handleMemoryDelete, handleMemoryForget, handleMemoryClear, handleMemoryPrune, handleMemoryStats } from "./routes/memory.js";
import { handleWorkflowsCreate, handleWorkflowsList, handleWorkflowsGet, handleWorkflowsUpdate, handleWorkflowsDelete, handleWorkflowsToggle, handleWorkflowsRun } from "./routes/workflows.js";
import { handleSchedulesCreate, handleSchedulesList, handleSchedulesGet, handleSchedulesUpdate, handleSchedulesDelete, handleSchedulesToggle, handleSchedulesRun } from "./routes/schedules.js";
import { handleNotificationsList, handleNotificationsUnreadCount, handleNotificationsCreate, handleNotificationsRead, handleNotificationsReadAll, handleNotificationsDelete, handleNotificationsClear } from "./routes/notifications.js";
import { handleAgentSystem, handleAgentCpu, handleAgentDisks, handleAgentNetwork, handleAgentProcesses, handleAgentKillProcess, handleAgentWindows, handleAgentFocusWindow, handleAgentOpenApp, handleAgentPowerShell, handleAgentReadFile, handleAgentListDir } from "./routes/agent.js";
import { handleGoogleStatus, handleGoogleAuthUrl, handleGoogleCallback, handleGoogleDisconnect, handleGmailList, handleGmailRead, handleCalendarList, handleDriveList, handleDocsRead, handleSheetsRead } from "./routes/google.js";
import { handleMicrosoftStatus, handleMicrosoftAuthUrl, handleMicrosoftCallback, handleMicrosoftDisconnect, handleOutlookList, handleOutlookRead, handleMicrosoftCalendarList, handleOneDriveList, handleExcelRead, handleTeamsList } from "./routes/microsoft.js";
import { handleBrowserStatus, handleBrowserNavigate, handleBrowserInfo, handleBrowserExtract, handleBrowserSearch, handleBrowserClick, handleBrowserType, handleBrowserFill, handleBrowserElements, handleBrowserScreenshot, handleBrowserScript, handleBrowserScroll, handleBrowserWait, handleBrowserBack, handleBrowserForward, handleBrowserClose } from "./routes/browser.js";
import { registerBuiltinTools } from "./lib/builtin-tools.js";
import { eventBus } from "./lib/events.js";
import { llmRouter } from "./lib/llm-router.js";
import { toolRegistry } from "./lib/registry.js";
import { memory } from "./lib/memory.js";
import { scheduler } from "./lib/scheduler.js";
import { setupAutoNotifications } from "./lib/notifications.js";
import { initDb } from "./lib/db.js";
import os from "node:os";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── Health & System ──────────────────────────────────────────

  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({
      message: ping,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/demo", handleDemo);

  // Real system metrics instead of Math.random()
  app.get("/api/status", (_req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    res.json({
      uptime: Math.floor(os.uptime()),
      cpu: Math.round(cpuUsage * 10) / 10,
      memory: Math.round((1 - freeMem / totalMem) * 100 * 10) / 10,
      totalMemoryGB: Math.round(totalMem / (1024 * 1024 * 1024) * 10) / 10,
      activeAutomations: store.automations.getActiveCount(),
      connectedIntegrations: store.integrations.getConnectedCount(),
      totalLogs: store.logs.count(),
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      // Phase 1 additions
      toolCount: toolRegistry.getAll().length,
      activeProvider: llmRouter.getActiveProvider(),
      availableProviders: llmRouter.getAvailableProviders(),
    });
  });

  // ── Commands / Chat ──────────────────────────────────────────

  app.post("/api/commands", handleCommandPost);
  app.post("/api/commands/stream", handleCommandStream);
  app.get("/api/commands", handleCommandGet);
  app.post("/api/commands/clear", handleCommandClear);

  // ── Automations ──────────────────────────────────────────────

  app.get("/api/automations", handleAutomationsList);
  app.post("/api/automations", handleAutomationsCreate);
  app.patch("/api/automations/:id/toggle", handleAutomationsToggle);
  app.delete("/api/automations/:id", handleAutomationsDelete);

  // ── Activity Logs ────────────────────────────────────────────

  app.get("/api/logs", handleLogsList);
  app.post("/api/logs", handleLogsCreate);
  app.delete("/api/logs", handleLogsClear);

  // ── Integrations ─────────────────────────────────────────────

  app.get("/api/integrations", handleIntegrationsList);
  app.get("/api/integrations/:id", handleIntegrationsGet);
  app.patch("/api/integrations/:id", handleIntegrationsUpdate);
  app.post("/api/integrations/:id/sync", handleIntegrationsSync);

  // ── Settings ────────────────────────────────────────────────

  app.get("/api/settings", handleSettingsGet);
  app.put("/api/settings", handleSettingsUpdate);

  // ── TTS ─────────────────────────────────────────────────────
  app.post("/api/tts", handleTTS);

  // ── Tool Registry (Phase 1) ─────────────────────────────────
  app.get("/api/tools", handleToolsList);
  app.get("/api/tools/runs", handleToolsRuns);
  app.get("/api/tools/:name", handleToolsGet);
  app.post("/api/tools/:name/execute", handleToolsExecute);
  app.patch("/api/tools/:name", handleToolsToggle);

  // ── Event System (Phase 1) ──────────────────────────────────
  app.get("/api/events", handleEventsList);
  app.get("/api/events/recent", handleEventsRecent);
  app.get("/api/events/stats", handleEventsStats);

  // ── Task Engine (Phase 2) ───────────────────────────────────
  app.post("/api/tasks", handleTasksExecute);
  app.get("/api/tasks", handleTasksList);
  app.get("/api/tasks/stats", handleTasksStats);
  app.get("/api/tasks/:id", handleTasksGet);
  app.post("/api/tasks/:id/cancel", handleTasksCancel);

  // ── Permission Engine (Phase 3) ─────────────────────────────
  app.get("/api/permissions", handlePermissionsStatus);
  app.get("/api/permissions/check/:toolName", handlePermissionsCheck);
  app.get("/api/permissions/overrides", handlePermissionsOverrides);
  app.get("/api/permissions/audit", handlePermissionsAudit);
  app.post("/api/permissions/override", handlePermissionsOverride);
  app.delete("/api/permissions/override/:toolName", handlePermissionsClearOverride);

  // ── Memory System (Phase 4) ─────────────────────────────────
  app.post("/api/memory", handleMemoryStore);
  app.put("/api/memory/upsert", handleMemoryUpsert);
  app.get("/api/memory", handleMemoryList);
  app.get("/api/memory/search", handleMemorySearch);
  app.get("/api/memory/stats", handleMemoryStats);
  app.post("/api/memory/forget", handleMemoryForget);
  app.post("/api/memory/clear", handleMemoryClear);
  app.post("/api/memory/prune", handleMemoryPrune);
  app.get("/api/memory/:id", handleMemoryGet);
  app.put("/api/memory/:id", handleMemoryUpdate);
  app.delete("/api/memory/:id", handleMemoryDelete);

  // ── Workflow Engine (Phase 5) ───────────────────────────────
  app.post("/api/workflows", handleWorkflowsCreate);
  app.get("/api/workflows", handleWorkflowsList);
  app.get("/api/workflows/:id", handleWorkflowsGet);
  app.put("/api/workflows/:id", handleWorkflowsUpdate);
  app.delete("/api/workflows/:id", handleWorkflowsDelete);
  app.post("/api/workflows/:id/toggle", handleWorkflowsToggle);
  app.post("/api/workflows/:id/run", handleWorkflowsRun);

  // ── Scheduler (Phase 5) ────────────────────────────────────
  app.post("/api/schedules", handleSchedulesCreate);
  app.get("/api/schedules", handleSchedulesList);
  app.get("/api/schedules/:id", handleSchedulesGet);
  app.put("/api/schedules/:id", handleSchedulesUpdate);
  app.delete("/api/schedules/:id", handleSchedulesDelete);
  app.post("/api/schedules/:id/toggle", handleSchedulesToggle);
  app.post("/api/schedules/:id/run", handleSchedulesRun);

  // ── Notifications (Phase 6) ─────────────────────────────────
  app.get("/api/notifications", handleNotificationsList);
  app.get("/api/notifications/unread-count", handleNotificationsUnreadCount);
  app.post("/api/notifications", handleNotificationsCreate);
  app.post("/api/notifications/read-all", handleNotificationsReadAll);
  app.post("/api/notifications/:id/read", handleNotificationsRead);
  app.delete("/api/notifications/:id", handleNotificationsDelete);
  app.delete("/api/notifications", handleNotificationsClear);

  // ── Windows Agent (Phase 8) ────────────────────────────────
  app.get("/api/agent/system", handleAgentSystem);
  app.get("/api/agent/cpu", handleAgentCpu);
  app.get("/api/agent/disks", handleAgentDisks);
  app.get("/api/agent/network", handleAgentNetwork);
  app.get("/api/agent/processes", handleAgentProcesses);
  app.post("/api/agent/processes/kill", handleAgentKillProcess);
  app.get("/api/agent/windows", handleAgentWindows);
  app.post("/api/agent/windows/focus", handleAgentFocusWindow);
  app.post("/api/agent/app/open", handleAgentOpenApp);
  app.post("/api/agent/powershell", handleAgentPowerShell);
  app.get("/api/agent/files/read", handleAgentReadFile);
  app.get("/api/agent/files/list", handleAgentListDir);

  // ── Google Integration (Phase 9) ───────────────────────────
  app.get("/api/google/status", handleGoogleStatus);
  app.get("/api/google/auth-url", handleGoogleAuthUrl);
  app.get("/api/google/callback", handleGoogleCallback);
  app.post("/api/google/disconnect", handleGoogleDisconnect);
  app.get("/api/google/gmail/messages", handleGmailList);
  app.get("/api/google/gmail/messages/:id", handleGmailRead);
  app.get("/api/google/calendar/events", handleCalendarList);
  app.get("/api/google/drive/files", handleDriveList);
  app.get("/api/google/docs/:id", handleDocsRead);
  app.get("/api/google/sheets/:id", handleSheetsRead);

  // ── Microsoft Integration (Phase 10) ───────────────────────
  app.get("/api/microsoft/status", handleMicrosoftStatus);
  app.get("/api/microsoft/auth-url", handleMicrosoftAuthUrl);
  app.get("/api/microsoft/callback", handleMicrosoftCallback);
  app.post("/api/microsoft/disconnect", handleMicrosoftDisconnect);
  app.get("/api/microsoft/outlook/messages", handleOutlookList);
  app.get("/api/microsoft/outlook/messages/:id", handleOutlookRead);
  app.get("/api/microsoft/calendar/events", handleMicrosoftCalendarList);
  app.get("/api/microsoft/onedrive/files", handleOneDriveList);
  app.get("/api/microsoft/excel/:fileId", handleExcelRead);
  app.get("/api/microsoft/teams", handleTeamsList);

  // ── Browser Automation (Phase 11) ───────────────────────
  app.get("/api/browser/status", handleBrowserStatus);
  app.post("/api/browser/navigate", handleBrowserNavigate);
  app.get("/api/browser/info", handleBrowserInfo);
  app.get("/api/browser/extract", handleBrowserExtract);
  app.post("/api/browser/search", handleBrowserSearch);
  app.post("/api/browser/click", handleBrowserClick);
  app.post("/api/browser/type", handleBrowserType);
  app.post("/api/browser/fill", handleBrowserFill);
  app.get("/api/browser/elements", handleBrowserElements);
  app.post("/api/browser/screenshot", handleBrowserScreenshot);
  app.post("/api/browser/script", handleBrowserScript);
  app.post("/api/browser/scroll", handleBrowserScroll);
  app.post("/api/browser/wait", handleBrowserWait);
  app.post("/api/browser/back", handleBrowserBack);
  app.post("/api/browser/forward", handleBrowserForward);
  app.post("/api/browser/close", handleBrowserClose);

  return app;
}

// ── Initialize Phase 1 systems ──────────────────────────────────
let _initialized = false;
export function initKerai(): void {
  if (_initialized) return;
  _initialized = true;

  console.log("\n[kerai] ══════════════════════════════════════════");
  console.log("[kerai]  KERAI Phase 1+2 — Initializing...");
  console.log("[kerai] ══════════════════════════════════════════");

  // Initialize database (Turso or local SQLite)
  initDb();

  // Register built-in tools
  registerBuiltinTools();

  // Log startup
  eventBus.emit("system.startup", "kerai", {
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    nodeVersion: process.version,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    activeProvider: llmRouter.getActiveProvider(),
  });

  const providers = llmRouter.getAvailableProviders();
  console.log(`[kerai] LLM Providers: ${providers.map((p) => `${p.provider} (${p.available ? "✓" : "✗"})`).join(", ")}`);
  console.log(`[kerai] Active provider: ${llmRouter.getActiveProvider()}`);
  console.log("[kerai] ══════════════════════════════════════════\n");

  // Prune expired memories on startup + every 10 minutes
  memory.prune();
  setInterval(() => memory.prune(), 10 * 60 * 1000);

  // Start the scheduler
  scheduler.start();

  // Setup auto-notification subscribers
  setupAutoNotifications();
}
