/** Typed mirrors of the Kerai.Server DTOs (source of truth: Kerai.Contracts). */

export type MissionLane = 'Master' | 'Coder' | 'Computer';

export type MissionStatus =
  | 'Created'
  | 'Running'
  | 'WaitingForApproval'
  | 'Verifying'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface Mission {
  id: string;
  goal: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  workspacePath: string | null;
  lane: MissionLane;
  result: string | null;
  error: string | null;
  /** Set on sub-missions dispatched by a Master mission to a specialist lane. */
  parentMissionId: string | null;
}

export interface KeraiSettings {
  defaultModel: string;
  workspaceRoot: string;
}

export type ApprovalStatus = 'Pending' | 'Granted' | 'Denied' | 'Expired';

export interface Approval {
  id: string;
  missionId: string;
  toolName: string;
  input: string;
  status: ApprovalStatus;
  expiresAt: string;
}

export interface AgentEvent {
  missionId: string;
  type: string;
  message: string;
  occurredAt: string;
}

export type PermissionLevel = 'Read' | 'Safe' | 'Modify' | 'System' | 'Critical';

export interface ToolContract {
  name: string;
  description: string;
  risk: PermissionLevel;
  requiresApproval: boolean;
  timeout: string;
}

export interface OllamaStatus {
  connected: boolean;
  endpoint: string;
  models: string[];
  error: string | null;
}

export interface HealthStatus {
  service: string;
  status: string;
  user?: string;
}

export interface StorageMetric {
  mount: string;
  totalBytes: number;
  usedBytes: number;
  percentUsed: number;
}

export interface GpuMetric {
  name: string | null;
  utilizationPercent: number | null;
  vramPercent: number | null;
}

export interface SystemStatus {
  cpuPercent: number;
  ramPercent: number;
  ramTotalBytes: number;
  ramUsedBytes: number;
  storage: StorageMetric[];
  gpu: GpuMetric | null;
  os: string;
  timestamp: string;
  error: string | null;
}

export type AutomationFrequency = 'Interval' | 'Daily';

export interface Automation {
  id: string;
  label: string;
  prompt: string;
  frequency: AutomationFrequency;
  intervalMinutes: number | null;
  dailyAt: string | null;
  enabled: boolean;
  createdAt: string;
  lastFiredAt: string | null;
  missionCount: number;
}

export interface WorkspaceEntry {
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
}

export interface WorkspaceSummary {
  name: string;
  root: string;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  hasGit: boolean;
  hasSolution: boolean;
  manifests: string[];
  topEntries: WorkspaceEntry[];
  error: string | null;
}

export interface MemorySnapshot {
  missions: Mission[];
  events: AgentEvent[];
  approvals: Approval[];
  activeMissionCount: number;
}

export interface MemoryClearResult {
  missionsCleared: number;
  approvalsCleared: number;
  eventsCleared: number;
}

export type Tone = 'accent' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
