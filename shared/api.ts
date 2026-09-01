/**
 * Shared code between client and server
 * Types used by both client and server for the WRAITH backend
 */

/**
 * Example response type for /api/demo
 */
export interface DemoResponse {
  message: string;
}

// ── Commands / Chat ──────────────────────────────────────────────

export interface CommandRequest {
  text: string;
  userId?: string;
}

export interface CommandResponse {
  id: string;
  role: "user" | "wraith";
  text: string;
  timestamp: string;
  /** If the command triggered an automation or integration action */
  action?: CommandAction;
}

export interface CommandAction {
  type: "automation" | "integration" | "system";
  target?: string;
  result?: string;
}

// ── Automations ──────────────────────────────────────────────────

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  active: boolean;
  integrationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationToggleRequest {
  id: string;
  active: boolean;
}

export interface AutomationCreateRequest {
  name: string;
  trigger: string;
  integrationId?: string;
}

// ── Integrations ─────────────────────────────────────────────────

export type IntegrationStatus = "connected" | "disconnected" | "error" | "idle";

export interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: IntegrationStatus;
  lastSyncedAt?: string;
}

export interface IntegrationToggleRequest {
  id: string;
  status: IntegrationStatus;
}

// ── Activity Logs ────────────────────────────────────────────────

export type LogLevel = "info" | "warning" | "error" | "success";

export interface LogEntry {
  id: string;
  level: LogLevel;
  source: string;
  message: string;
  timestamp: string;
}

export interface LogCreateRequest {
  level: LogLevel;
  source: string;
  message: string;
}

// ── System ───────────────────────────────────────────────────────

export interface SystemStatus {
  uptime: number;
  cpu: number;
  memory: number;
  activeAutomations: number;
  connectedIntegrations: number;
  totalLogs: number;
  geminiConfigured?: boolean;
}

export interface PingResponse {
  message: string;
  timestamp: string;
}

// ── Persona ─────────────────────────────────────────────────────

export type WraithPersona = "female" | "male";

export type VoiceStyle = "warm" | "energetic" | "calm" | "whisper";

// ── Settings ─────────────────────────────────────────────────────

export interface WraithSettings {
  // General
  displayName: string;
  theme: "dark" | "light" | "system";
  notifications: boolean;
  autoStart: boolean;
  persona: WraithPersona;
  voiceStyle: VoiceStyle;
  voiceDelay: number; // ms before voice starts after text appears

  // Permissions
  permissions: {
    email: boolean;
    calendar: boolean;
    files: boolean;
    documents: boolean;
    presentations: boolean;
    osControl: boolean;
    cloudInfrastructure: boolean;
    dataAnalysis: boolean;
  };

  // Ghost Mode
  ghostMode: {
    enabled: boolean;
    stealthLevel: "low" | "medium" | "high";
    clearTraces: boolean;
    rotateSessionId: boolean;
    hideFromTaskManager: boolean;
    encryptLogs: boolean;
  };

  // Voice
  voice: {
    enabled: boolean;
    wakeWord: string;
    voiceName: string;
    speed: number;
    autoListen: boolean;
    pushToTalk: boolean;
  };

  // Advanced
  advanced: {
    debugMode: boolean;
    logRetentionDays: number;
    maxConcurrentTasks: number;
    commandHistorySize: number;
    apiTimeout: number;
  };
}

export type SettingsUpdateRequest = Partial<WraithSettings>;

// ── Tool Registry (Phase 1) ─────────────────────────────────────

export type ToolCategory =
  | "computer"
  | "browser"
  | "email"
  | "calendar"
  | "files"
  | "documents"
  | "cloud"
  | "search"
  | "system"
  | "automation"
  | "custom";

export type PermissionLevel = 0 | 1 | 2 | 3; // 0=info, 1=normal, 2=sensitive, 3=high-risk
export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>; // JSON Schema object
  outputSchema: Record<string, unknown>;
  permissionLevel: PermissionLevel;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  provider: string; // "local" | "google" | "microsoft" | "browser" | "custom"
  enabled: boolean;
  timeout: number; // ms
  retryCount: number;
}

export interface ToolCall {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  toolName: string;
  timestamp: string;
}

// ── Task Engine (Phase 1) ───────────────────────────────────────

export type TaskStatus =
  | "queued"
  | "planning"
  | "waiting_for_permission"
  | "executing"
  | "verifying"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

export interface TaskStep {
  id: string;
  order: number;
  description: string;
  toolName?: string;
  input?: Record<string, unknown>;
  status: TaskStatus;
  result?: ToolResult;
  startedAt?: string;
  completedAt?: string;
}

export interface Task {
  id: string;
  objective: string;
  plan: string[];
  steps: TaskStep[];
  status: TaskStatus;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  permissionLevel: PermissionLevel;
}

// ── Event System (Phase 1) ──────────────────────────────────────

export type KeraiEventType =
  | "system.startup"
  | "system.shutdown"
  | "system.error"
  | "system.status"
  | "llm.request"
  | "llm.response"
  | "llm.error"
  | "llm.stream.chunk"
  | "tool.registered"
  | "tool.invoked"
  | "tool.completed"
  | "tool.error"
  | "tool.denied"
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "task.permission_required"
  | "permission.granted"
  | "permission.denied"
  | "memory.stored"
  | "memory.retrieved"
  | "memory.deleted"
  | "automation.started"
  | "automation.completed"
  | "automation.failed"
  | "voice.listening"
  | "voice.speaking"
  | "voice.transcript"
  | "connector.connected"
  | "connector.disconnected"
  | "connector.error"
  | "user.command"
  | "user.response";

export interface KeraiEvent {
  id: string;
  type: KeraiEventType;
  source: string;
  data?: Record<string, unknown>;
  timestamp: string;
  severity: "trace" | "info" | "warn" | "error";
}

// ── Memory System (Phase 1) ─────────────────────────────────────

export type MemoryLayer = "short_term" | "working" | "long_term" | "episodic";

export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  key: string;
  value: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  tags: string[];
}

// ── LLM Router (Phase 1) ────────────────────────────────────────

export type LLMProvider = "gemini" | "openai" | "anthropic" | "local";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMResponse {
  text: string;
  provider: LLMProvider;
  model: string;
  tokensUsed?: { input: number; output: number; };
  latencyMs: number;
  toolCalls?: ToolCall[];
}

// ── API: Tool List ──────────────────────────────────────────────

export interface ToolListResponse {
  tools: ToolDefinition[];
  total: number;
  byCategory: Record<ToolCategory, number>;
}

// ── API: Task List ──────────────────────────────────────────────

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  byStatus: Record<TaskStatus, number>;
}
