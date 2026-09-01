import { toolRegistry } from "./registry.js";
import { eventBus } from "./events.js";
import { store } from "../store.js";
import { googleConnector } from "./google.js";
import { microsoftConnector } from "./microsoft.js";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { ToolDefinition } from "@shared/api";

/**
 * Register all built-in KERAI tools.
 * Called once at server startup.
 */
export function registerBuiltinTools(): void {
  console.log("[kerai] Registering built-in tools...");

  // ── System Tools ────────────────────────────────────────────

  registerTool({
    name: "system.get_status",
    description: "Get current system status: CPU, memory, uptime, platform info",
    category: "system",
    inputSchema: {},
    outputSchema: { cpu: "number", memory: "number", uptime: "number", platform: "string" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async () => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    return {
      cpu: Math.round(cpuUsage * 10) / 10,
      memory: Math.round((1 - freeMem / totalMem) * 100 * 10) / 10,
      totalMemory: Math.round(totalMem / (1024 * 1024 * 1024) * 10) / 10 + " GB",
      uptime: Math.floor(os.uptime()),
      platform: os.platform(),
      hostname: os.hostname(),
      arch: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || "unknown",
      loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    };
  });

  registerTool({
    name: "system.list_processes",
    description: "List running processes with CPU and memory usage",
    category: "system",
    inputSchema: { top: { type: "number", description: "Number of processes to return (default 20)" } },
    outputSchema: { processes: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 10000,
    retryCount: 0,
  }, async (input) => {
    const top = (input.top as number) || 20;
    try {
      const isWin = os.platform() === "win32";
      const cmd = isWin
        ? `powershell -Command "Get-Process | Sort-Object -Property CPU -Descending | Select-Object -First ${top} Name, Id, CPU, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json"`
        : `ps aux --sort=-%cpu | head -${top + 1}`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 8000 });

      if (isWin) {
        return { processes: JSON.parse(output || "[]") };
      }
      const lines = output.split("\n").filter(Boolean);
      const header = lines[0];
      const procs = lines.slice(1).map((line) => {
        const parts = line.split(/\s+/);
        return {
          user: parts[0],
          pid: parseInt(parts[1]),
          cpu: parseFloat(parts[2]),
          mem: parseFloat(parts[3]),
          command: parts.slice(10).join(" "),
        };
      });
      return { processes: procs };
    } catch {
      return { processes: [], note: "Could not list processes" };
    }
  });

  registerTool({
    name: "system.get_disk_usage",
    description: "Get disk usage information",
    category: "system",
    inputSchema: {},
    outputSchema: { disks: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async () => {
    try {
      const isWin = os.platform() === "win32";
      const cmd = isWin
        ? `powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='UsedGB';E={[math]::Round($_.Used/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}} | ConvertTo-Json"`
        : `df -h --output=source,size,used,avail,pcent,target 2>/dev/null || df -h`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
      return { raw: output.trim() };
    } catch {
      return { raw: "Could not get disk info" };
    }
  });

  // ── File Tools ──────────────────────────────────────────────

  registerTool({
    name: "files.read",
    description: "Read the contents of a text file",
    category: "files",
    inputSchema: { path: { type: "string", description: "File path to read" } },
    outputSchema: { content: "string", size: "number" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 10000,
    retryCount: 0,
  }, async (input) => {
    const filePath = input.path as string;
    if (!filePath) throw new Error("path is required");
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (stat.size > 10 * 1024 * 1024) throw new Error("File too large (>10MB)");
    const content = fs.readFileSync(resolved, "utf-8");
    return { content, size: stat.size, path: resolved };
  });

  registerTool({
    name: "files.write",
    description: "Write content to a file (creates or overwrites)",
    category: "files",
    inputSchema: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Content to write" },
    },
    outputSchema: { success: "boolean", bytesWritten: "number" },
    permissionLevel: 2,
    riskLevel: "medium",
    requiresConfirmation: true,
    provider: "local",
    enabled: true,
    timeout: 10000,
    retryCount: 0,
  }, async (input) => {
    const filePath = input.path as string;
    const content = input.content as string;
    if (!filePath || content === undefined) throw new Error("path and content are required");
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content, "utf-8");
    return { success: true, bytesWritten: Buffer.byteLength(content), path: resolved };
  });

  registerTool({
    name: "files.list",
    description: "List files and directories at a given path",
    category: "files",
    inputSchema: {
      path: { type: "string", description: "Directory path (default: current directory)" },
      recursive: { type: "boolean", description: "List recursively" },
    },
    outputSchema: { files: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 10000,
    retryCount: 0,
  }, async (input) => {
    const dirPath = (input.path as string) || process.cwd();
    const resolved = path.resolve(dirPath);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return {
      path: resolved,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      })),
    };
  });

  // ── Shell Tool ──────────────────────────────────────────────

  registerTool({
    name: "system.run_command",
    description: "Execute a shell command and return its output. Use with caution.",
    category: "system",
    inputSchema: {
      command: { type: "string", description: "Shell command to execute" },
      cwd: { type: "string", description: "Working directory" },
    },
    outputSchema: { stdout: "string", stderr: "string", exitCode: "number" },
    permissionLevel: 3,
    riskLevel: "high",
    requiresConfirmation: true,
    provider: "local",
    enabled: true,
    timeout: 30000,
    retryCount: 0,
  }, async (input) => {
    const command = input.command as string;
    const cwd = (input.cwd as string) || process.cwd();
    if (!command) throw new Error("command is required");
    try {
      const stdout = execSync(command, {
        encoding: "utf-8",
        timeout: 25000,
        cwd,
        maxBuffer: 1024 * 1024,
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message,
        exitCode: err.status || 1,
      };
    }
  });

  // ── Automation Tools ────────────────────────────────────────

  registerTool({
    name: "automation.list",
    description: "List all configured automations",
    category: "automation",
    inputSchema: {},
    outputSchema: { automations: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async () => {
    const automations = store.automations.getAll();
    return { automations, total: automations.length, active: automations.filter((a) => a.active).length };
  });

  registerTool({
    name: "automation.toggle",
    description: "Enable or disable an automation by ID",
    category: "automation",
    inputSchema: {
      id: { type: "string", description: "Automation ID" },
      active: { type: "boolean", description: "Enable or disable" },
    },
    outputSchema: { success: "boolean" },
    permissionLevel: 2,
    riskLevel: "medium",
    requiresConfirmation: true,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async (input) => {
    const id = input.id as string;
    const active = input.active as boolean;
    const auto = store.automations.getById(id);
    if (!auto) throw new Error(`Automation "${id}" not found`);
    store.automations.update(id, { active });
    return { success: true, name: auto.name, active };
  });

  // ── Integration Tools ───────────────────────────────────────

  registerTool({
    name: "integration.list",
    description: "List all configured integrations and their status",
    category: "cloud",
    inputSchema: {},
    outputSchema: { integrations: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async () => {
    const integrations = store.integrations.getAll();
    return {
      integrations,
      total: integrations.length,
      connected: integrations.filter((i) => i.status === "connected").length,
    };
  });

  registerTool({
    name: "integration.sync",
    description: "Trigger a sync on a connected integration",
    category: "cloud",
    inputSchema: {
      id: { type: "string", description: "Integration ID" },
    },
    outputSchema: { success: "boolean" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const id = input.id as string;
    const integration = store.integrations.getById(id);
    if (!integration) throw new Error(`Integration "${id}" not found`);
    if (integration.status !== "connected") throw new Error(`Integration "${id}" is not connected`);
    store.integrations.update(id, { lastSyncedAt: new Date().toISOString() });
    return { success: true, name: integration.name, syncedAt: new Date().toISOString() };
  });

  // ── Log Tools ───────────────────────────────────────────────

  registerTool({
    name: "logs.read",
    description: "Read recent activity logs",
    category: "system",
    inputSchema: {
      limit: { type: "number", description: "Number of logs to return (default 20)" },
      level: { type: "string", description: "Filter by level: info, warning, error, success" },
    },
    outputSchema: { logs: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async (input) => {
    const limit = (input.limit as number) || 20;
    const logs = store.logs.getAll(limit);
    const level = input.level as string | undefined;
    const filtered = level ? logs.filter((l) => l.level === level) : logs;
    return { logs: filtered, total: filtered.length };
  });

  // ── Application Control Tools ──────────────────────────────

  registerTool({
    name: "computer.open_application",
    description: "Open an application by name or path",
    category: "computer",
    inputSchema: {
      name: { type: "string", description: "Application name or executable path" },
      args: { type: "string", description: "Optional arguments to pass" },
    },
    outputSchema: { success: "boolean", pid: "number" },
    permissionLevel: 2,
    riskLevel: "medium",
    requiresConfirmation: true,
    provider: "local",
    enabled: true,
    timeout: 15000,
    retryCount: 0,
  }, async (input) => {
    const appName = input.name as string;
    if (!appName) throw new Error("name is required");
    const args = (input.args as string) || "";
    const isWin = os.platform() === "win32";

    try {
      if (isWin) {
        const cmd = `powershell -Command "Start-Process '${appName}' ${args ? `-ArgumentList '${args}'` : ''} -PassThru | Select-Object Id | ConvertTo-Json"`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 10000 });
        const parsed = JSON.parse(output);
        return { success: true, pid: parsed.Id };
      } else {
        const cmd = `${appName} ${args} &`;
        execSync(cmd, { encoding: "utf-8", timeout: 5000, detached: true } as any);
        return { success: true, pid: 0 };
      }
    } catch (err: any) {
      throw new Error(`Failed to open "${appName}": ${err.message}`);
    }
  });

  registerTool({
    name: "computer.close_application",
    description: "Close an application by name or PID",
    category: "computer",
    inputSchema: {
      name: { type: "string", description: "Application name" },
      pid: { type: "number", description: "Process ID (alternative to name)" },
      force: { type: "boolean", description: "Force close (default: true)" },
    },
    outputSchema: { success: "boolean", closed: "number" },
    permissionLevel: 3,
    riskLevel: "high",
    requiresConfirmation: true,
    provider: "local",
    enabled: true,
    timeout: 15000,
    retryCount: 0,
  }, async (input) => {
    const appName = input.name as string | undefined;
    const pid = input.pid as number | undefined;
    const force = input.force !== false;
    const isWin = os.platform() === "win32";

    try {
      if (isWin) {
        const target = pid
          ? `-Id ${pid}`
          : `-Name '${appName}'`;
        const cmd = `powershell -Command "Stop-Process ${target} ${force ? '-Force' : ''} -ErrorAction SilentlyContinue; (Get-Process ${target} -ErrorAction SilentlyContinue).Count || 0"`;
        execSync(cmd, { encoding: "utf-8", timeout: 10000 });
        return { success: true, closed: 1 };
      } else {
        const target = pid ? `${pid}` : appName;
        execSync(`kill ${force ? '-9' : ''} ${target}`, { encoding: "utf-8", timeout: 5000 });
        return { success: true, closed: 1 };
      }
    } catch {
      return { success: true, closed: 0 };
    }
  });

  registerTool({
    name: "computer.list_windows",
    description: "List all visible application windows with titles",
    category: "computer",
    inputSchema: {},
    outputSchema: { windows: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 10000,
    retryCount: 0,
  }, async () => {
    const isWin = os.platform() === "win32";
    try {
      if (isWin) {
        const cmd = `powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Name, Id, MainWindowTitle | ConvertTo-Json"`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 8000 });
        const parsed = JSON.parse(output || "[]");
        const windows = Array.isArray(parsed) ? parsed : [parsed];
        return {
          windows: windows.map((w: any) => ({
            name: w.Name,
            pid: w.Id,
            title: w.MainWindowTitle,
          })),
        };
      } else {
        return { windows: [], note: "Window listing not available on this platform" };
      }
    } catch {
      return { windows: [] };
    }
  });

  registerTool({
    name: "computer.get_network",
    description: "Get network interface information and connectivity status",
    category: "system",
    inputSchema: {},
    outputSchema: { interfaces: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 8000,
    retryCount: 0,
  }, async () => {
    const isWin = os.platform() === "win32";
    try {
      if (isWin) {
        const cmd = `powershell -Command "Get-NetAdapter | Where-Object { \$_.Status -eq 'Up' } | Select-Object Name, InterfaceDescription, MacAddress, LinkSpeed | ConvertTo-Json"`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 8000 });
        const parsed = JSON.parse(output || "[]");
        const adapters = Array.isArray(parsed) ? parsed : [parsed];
        return {
          interfaces: adapters.map((a: any) => ({
            name: a.Name,
            description: a.InterfaceDescription,
            mac: a.MacAddress,
            speed: a.LinkSpeed,
          })),
          hostname: os.hostname(),
          platform: os.platform(),
        };
      }
      const nets = os.networkInterfaces();
      return {
        interfaces: Object.entries(nets).map(([name, addrs]) => ({
          name,
          addresses: (addrs || []).map((a) => ({
            address: a.address,
            family: a.family,
            internal: a.internal,
          })),
        })),
        hostname: os.hostname(),
        platform: os.platform(),
      };
    } catch {
      return { interfaces: [], hostname: os.hostname() };
    }
  });

  // ── Settings Tools ──────────────────────────────────────────

  registerTool({
    name: "settings.get",
    description: "Get current KERAI settings",
    category: "system",
    inputSchema: {},
    outputSchema: { settings: "object" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async () => {
    return { settings: store.settings.get() };
  });

  // ── Google Tools ──────────────────────────────────────────

  registerTool({
    name: "google.gmail.list",
    description: "List recent Gmail messages with subject, sender, and date",
    category: "email",
    inputSchema: { query: { type: "string", description: "Gmail search query (e.g. 'is:unread', 'from:someone@email.com')" }, maxResults: { type: "number", description: "Max messages (default 10)" } },
    outputSchema: { messages: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "google",
    enabled: googleConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const query = (input.query as string) || "";
    const max = (input.maxResults as number) || 10;
    return googleConnector.gmailListMessages("default", query, max);
  });

  registerTool({
    name: "google.gmail.read",
    description: "Read a Gmail message by ID — returns full content",
    category: "email",
    inputSchema: { messageId: { type: "string", description: "Gmail message ID" } },
    outputSchema: { subject: "string", from: "string", body: "string" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "google",
    enabled: googleConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const id = input.messageId as string;
    if (!id) throw new Error("messageId is required");
    return googleConnector.gmailReadMessage("default", id);
  });

  registerTool({
    name: "google.calendar.list",
    description: "List upcoming Google Calendar events",
    category: "calendar",
    inputSchema: { maxResults: { type: "number", description: "Max events (default 10)" } },
    outputSchema: { events: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "google",
    enabled: googleConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const max = (input.maxResults as number) || 10;
    return googleConnector.calendarListEvents("default", undefined, undefined, max);
  });

  registerTool({
    name: "google.drive.list",
    description: "List files in Google Drive",
    category: "files",
    inputSchema: { query: { type: "string", description: "Drive search query" }, maxResults: { type: "number", description: "Max files (default 10)" } },
    outputSchema: { files: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "google",
    enabled: googleConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const query = (input.query as string) || "";
    const max = (input.maxResults as number) || 10;
    return googleConnector.driveListFiles("default", query, max);
  });

  registerTool({
    name: "google.docs.read",
    description: "Read a Google Docs document by ID",
    category: "documents",
    inputSchema: { documentId: { type: "string", description: "Google Docs document ID" } },
    outputSchema: { title: "string", text: "string" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "google",
    enabled: googleConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const id = input.documentId as string;
    if (!id) throw new Error("documentId is required");
    return googleConnector.docsReadDocument("default", id);
  });

  // ── Microsoft Tools ────────────────────────────────────────

  registerTool({
    name: "microsoft.outlook.list",
    description: "List recent Outlook/Exchange emails",
    category: "email",
    inputSchema: { filter: { type: "string", description: "OData filter (e.g. 'isRead eq false')" }, top: { type: "number", description: "Max messages (default 10)" } },
    outputSchema: { messages: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "microsoft",
    enabled: microsoftConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const filter = (input.filter as string) || "";
    const top = (input.top as number) || 10;
    return microsoftConnector.outlookListMessages("default", filter, top);
  });

  registerTool({
    name: "microsoft.outlook.read",
    description: "Read an Outlook email by ID",
    category: "email",
    inputSchema: { messageId: { type: "string", description: "Message ID" } },
    outputSchema: { subject: "string", body: "string" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "microsoft",
    enabled: microsoftConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const id = input.messageId as string;
    if (!id) throw new Error("messageId is required");
    return microsoftConnector.outlookReadMessage("default", id);
  });

  registerTool({
    name: "microsoft.calendar.list",
    description: "List upcoming Outlook/Exchange calendar events",
    category: "calendar",
    inputSchema: { top: { type: "number", description: "Max events (default 10)" } },
    outputSchema: { events: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "microsoft",
    enabled: microsoftConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const top = (input.top as number) || 10;
    return microsoftConnector.calendarListEvents("default", top);
  });

  registerTool({
    name: "microsoft.onedrive.list",
    description: "List files in OneDrive",
    category: "files",
    inputSchema: { folder: { type: "string", description: "Folder path (default: root)" }, top: { type: "number", description: "Max files (default 20)" } },
    outputSchema: { files: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "microsoft",
    enabled: microsoftConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const folder = (input.folder as string) || "root";
    const top = (input.top as number) || 20;
    return microsoftConnector.onedriveListFiles("default", folder, top);
  });

  registerTool({
    name: "microsoft.excel.read",
    description: "Read data from an Excel file in OneDrive",
    category: "documents",
    inputSchema: { fileId: { type: "string", description: "OneDrive file ID" }, sheet: { type: "string", description: "Sheet name (default: Sheet1)" }, range: { type: "string", description: "Cell range (default: A1:Z100)" } },
    outputSchema: { values: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "microsoft",
    enabled: microsoftConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const fileId = input.fileId as string;
    const sheet = (input.sheet as string) || "Sheet1";
    const range = (input.range as string) || "A1:Z100";
    if (!fileId) throw new Error("fileId is required");
    return microsoftConnector.excelReadSheet("default", fileId, sheet, range);
  });

  registerTool({
    name: "microsoft.teams.list",
    description: "List Teams channels and messages",
    category: "cloud",
    inputSchema: { teamId: { type: "string", description: "Team ID" }, channelId: { type: "string", description: "Channel ID" }, top: { type: "number", description: "Max messages (default 20)" } },
    outputSchema: { messages: "array", teams: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "microsoft",
    enabled: microsoftConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const teamId = input.teamId as string | undefined;
    const channelId = input.channelId as string | undefined;
    const top = (input.top as number) || 20;
    return microsoftConnector.teamsListMessages("default", teamId, channelId, top);
  });

  registerTool({
    name: "google.sheets.read",
    description: "Read a Google Sheets spreadsheet by ID",
    category: "documents",
    inputSchema: { spreadsheetId: { type: "string", description: "Google Sheets spreadsheet ID" }, range: { type: "string", description: "Cell range (default: Sheet1!A1:Z100)" } },
    outputSchema: { values: "array" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "google",
    enabled: googleConnector.isConnected(),
    timeout: 15000,
    retryCount: 1,
  }, async (input) => {
    const id = input.spreadsheetId as string;
    const range = (input.range as string) || "Sheet1!A1:Z100";
    if (!id) throw new Error("spreadsheetId is required");
    return googleConnector.sheetsReadSpreadsheet("default", id, range);
  });

  // ── Browser Automation Tools ───────────────────────────────

  registerTool({
    name: "browser.navigate",
    description: "Navigate to a URL in the browser",
    category: "browser",
    inputSchema: { url: { type: "string", description: "URL to navigate to" } },
    outputSchema: { title: "string", url: "string", status: "number" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 30000,
    retryCount: 0,
  }, async (input) => {
    const { navigate } = await import("./browser.js");
    return navigate(input.url as string);
  });

  registerTool({
    name: "browser.search",
    description: "Search the web using Google, Bing, or DuckDuckGo",
    category: "browser",
    inputSchema: {
      query: { type: "string", description: "Search query" },
      engine: { type: "string", description: "Search engine: google, bing, duckduckgo (default: google)" },
      maxResults: { type: "number", description: "Max results (default 10)" },
    },
    outputSchema: { results: "array", total: "number" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 30000,
    retryCount: 0,
  }, async (input) => {
    const { searchWeb } = await import("./browser.js");
    const results = await searchWeb(
      input.query as string,
      (input.engine as any) || "google",
      (input.maxResults as number) || 10
    );
    return { query: input.query, engine: input.engine || "google", results, total: results.length };
  });

  registerTool({
    name: "browser.extract",
    description: "Extract content (text, links, images, headings) from the current page",
    category: "browser",
    inputSchema: { maxLength: { type: "number", description: "Max text length (default 50000)" } },
    outputSchema: { title: "string", url: "string", text: "string", headings: "array", links: "array", images: "array" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 15000,
    retryCount: 0,
  }, async (input) => {
    const { extractContent } = await import("./browser.js");
    return extractContent((input.maxLength as number) || 50000);
  });

  registerTool({
    name: "browser.click",
    description: "Click an element on the page by CSS selector",
    category: "browser",
    inputSchema: {
      selector: { type: "string", description: "CSS selector (e.g. '#submit-btn', 'a.login')" },
      waitForNavigation: { type: "boolean", description: "Wait for page navigation" },
    },
    outputSchema: { success: "boolean", url: "string" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 15000,
    retryCount: 0,
  }, async (input) => {
    const { clickElement, getCurrentPage } = await import("./browser.js");
    await clickElement(input.selector as string, { waitForNavigation: input.waitForNavigation as boolean });
    return getCurrentPage();
  });

  registerTool({
    name: "browser.type",
    description: "Type text into an input field",
    category: "browser",
    inputSchema: {
      selector: { type: "string", description: "CSS selector for input" },
      text: { type: "string", description: "Text to type" },
      pressEnter: { type: "boolean", description: "Press Enter after typing" },
      clear: { type: "boolean", description: "Clear field before typing" },
    },
    outputSchema: { success: "boolean" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 10000,
    retryCount: 0,
  }, async (input) => {
    const { typeText } = await import("./browser.js");
    await typeText(input.selector as string, input.text as string, {
      pressEnter: input.pressEnter as boolean,
      clear: input.clear as boolean,
    });
    return { success: true };
  });

  registerTool({
    name: "browser.screenshot",
    description: "Take a screenshot of the current page or a specific element",
    category: "browser",
    inputSchema: {
      fullPage: { type: "boolean", description: "Capture full page (default: viewport only)" },
      selector: { type: "string", description: "CSS selector to screenshot specific element" },
    },
    outputSchema: { base64: "string", width: "number", height: "number" },
    permissionLevel: 1,
    riskLevel: "low",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 15000,
    retryCount: 0,
  }, async (input) => {
    const { takeScreenshot } = await import("./browser.js");
    return takeScreenshot({ fullPage: input.fullPage as boolean, selector: input.selector as string });
  });

  registerTool({
    name: "browser.elements",
    description: "List all interactive elements (buttons, links, inputs) on the current page",
    category: "browser",
    inputSchema: {},
    outputSchema: { elements: "array", total: "number" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 10000,
    retryCount: 0,
  }, async () => {
    const { getInteractiveElements } = await import("./browser.js");
    const elements = await getInteractiveElements();
    return { elements, total: elements.length };
  });

  registerTool({
    name: "browser.close",
    description: "Close the browser and free resources",
    category: "browser",
    inputSchema: {},
    outputSchema: { success: "boolean" },
    permissionLevel: 0,
    riskLevel: "none",
    requiresConfirmation: false,
    provider: "local",
    enabled: true,
    timeout: 5000,
    retryCount: 0,
  }, async () => {
    const { closeBrowser } = await import("./browser.js");
    await closeBrowser();
    return { success: true };
  });

  const toolCount = toolRegistry.getAll().length;
  console.log(`[kerai] ✅ Registered ${toolCount} built-in tools`);

  eventBus.emit("system.startup", "kerai", {
    toolCount,
    message: `${toolCount} tools registered and ready`,
  });
}

/**
 * Helper to register a tool concisely
 */
function registerTool(definition: ToolDefinition, handler: (input: Record<string, unknown>) => Promise<unknown>): void {
  toolRegistry.register(definition, handler);
}
