import type { Automation, Integration, LogEntry, CommandResponse, WraithSettings } from "@shared/api";

/**
 * Deep merge two objects, with the source values taking precedence.
 * Only merges plain objects; other values are replaced.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

// ── In-memory data store ─────────────────────────────────────────

let _commands: CommandResponse[] = [];

let _automations: Automation[] = [
  {
    id: "auto-1",
    name: "Inbox triage",
    trigger: "New mail in Outlook",
    active: true,
    integrationId: "int-outlook",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "auto-2",
    name: "Meeting brief",
    trigger: "15 min before Teams call",
    active: true,
    integrationId: "int-teams",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "auto-3",
    name: "Nightly backup",
    trigger: "Every day at 02:00",
    active: true,
    integrationId: "int-onedrive",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "auto-4",
    name: "Screen lock on idle",
    trigger: "No input for 5 min",
    active: false,
    integrationId: "int-windows",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "auto-5",
    name: "Report compiler",
    trigger: "Friday 17:00",
    active: true,
    integrationId: "int-excel",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

let _integrations: Integration[] = [
  { id: "int-outlook", name: "Outlook", description: "Mail & calendar sync", icon: "Mail", status: "connected", lastSyncedAt: new Date().toISOString() },
  { id: "int-teams", name: "Teams", description: "Messages & meetings", icon: "MessageCircle", status: "connected", lastSyncedAt: new Date().toISOString() },
  { id: "int-onedrive", name: "OneDrive", description: "File access & backup", icon: "Cloud", status: "connected", lastSyncedAt: new Date().toISOString() },
  { id: "int-excel", name: "Excel", description: "Data & reporting", icon: "FileSpreadsheet", status: "connected", lastSyncedAt: new Date().toISOString() },
  { id: "int-word", name: "Word", description: "Document drafting", icon: "FileText", status: "connected", lastSyncedAt: new Date().toISOString() },
  { id: "int-powerpoint", name: "PowerPoint", description: "Deck generation", icon: "Presentation", status: "idle" },
  { id: "int-windows", name: "Windows", description: "OS-level control", icon: "AppWindow", status: "connected", lastSyncedAt: new Date().toISOString() },
  { id: "int-azure", name: "Azure", description: "Cloud infrastructure", icon: "CloudCog", status: "idle" },
];

let _settings: WraithSettings = {
  displayName: "Kishan",
  theme: "dark",
  notifications: true,
  autoStart: true,
  persona: "female",
  voiceStyle: "warm",
  voiceDelay: 600,
  permissions: {
    email: true,
    calendar: true,
    files: true,
    documents: true,
    presentations: false,
    osControl: true,
    cloudInfrastructure: false,
    dataAnalysis: true,
  },
  ghostMode: {
    enabled: true,
    stealthLevel: "high",
    clearTraces: true,
    rotateSessionId: true,
    hideFromTaskManager: true,
    encryptLogs: true,
  },
  voice: {
    enabled: true,
    wakeWord: "Hey Wraith",
    voiceName: "Nova",
    speed: 1.0,
    autoListen: false,
    pushToTalk: false,
  },
  advanced: {
    debugMode: false,
    logRetentionDays: 30,
    maxConcurrentTasks: 5,
    commandHistorySize: 100,
    apiTimeout: 30,
  },
};

let _logs: LogEntry[] = [
  { id: "log-1", level: "info", source: "system", message: "WRAITH core initialized — full device access granted", timestamp: new Date(Date.now() - 60000).toISOString() },
  { id: "log-2", level: "info", source: "voice", message: "wake word engine armed", timestamp: new Date(Date.now() - 50000).toISOString() },
  { id: "log-3", level: "success", source: "ms365", message: "outlook, teams, onedrive, excel synced", timestamp: new Date(Date.now() - 40000).toISOString() },
  { id: "log-4", level: "info", source: "ghost", message: "background mode engaged — zero UI footprint", timestamp: new Date(Date.now() - 30000).toISOString() },
];

// ── ID generator ─────────────────────────────────────────────────

let _idCounter = 100;
export function generateId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

// ── Store accessors ──────────────────────────────────────────────

export const store = {
  commands: {
    getAll: () => _commands,
    add: (cmd: CommandResponse) => {
      _commands = [..._commands.slice(-99), cmd]; // keep last 100
      return cmd;
    },
  },

  automations: {
    getAll: () => _automations,
    getById: (id: string) => _automations.find((a) => a.id === id),
    create: (auto: Automation) => {
      _automations = [..._automations, auto];
      return auto;
    },
    update: (id: string, patch: Partial<Automation>) => {
      _automations = _automations.map((a) =>
        a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a,
      );
      return _automations.find((a) => a.id === id);
    },
    delete: (id: string) => {
      _automations = _automations.filter((a) => a.id !== id);
    },
    getActiveCount: () => _automations.filter((a) => a.active).length,
  },

  integrations: {
    getAll: () => _integrations,
    getById: (id: string) => _integrations.find((i) => i.id === id),
    update: (id: string, patch: Partial<Integration>) => {
      _integrations = _integrations.map((i) =>
        i.id === id ? { ...i, ...patch, lastSyncedAt: new Date().toISOString() } : i,
      );
      return _integrations.find((i) => i.id === id);
    },
    getConnectedCount: () => _integrations.filter((i) => i.status === "connected").length,
  },

  logs: {
    getAll: (limit?: number) => {
      const all = [..._logs].reverse(); // newest first
      return limit ? all.slice(0, limit) : all;
    },
    add: (entry: LogEntry) => {
      _logs = [..._logs.slice(-499), entry]; // keep last 500
      return entry;
    },
    clear: () => {
      _logs = [];
    },
    count: () => _logs.length,
  },

  settings: {
    get: () => _settings,
    update: (patch: Partial<WraithSettings>) => {
      _settings = deepMerge(
        _settings as unknown as Record<string, unknown>,
        patch as unknown as Record<string, unknown>,
      ) as unknown as WraithSettings;
      return _settings;
    },
  },

  /** Boot time for uptime calc */
  bootTime: Date.now(),
};
