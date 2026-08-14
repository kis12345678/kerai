import type {
  AgentEvent,
  Approval,
  Automation,
  AutomationFrequency,
  MissionLane,
  HealthStatus,
  KeraiSettings,
  MemoryClearResult,
  MemorySnapshot,
  Mission,
  OllamaStatus,
  SystemStatus,
  ToolContract,
  WorkspaceSummary,
} from './types';

/**
 * The KERAI gateway base URL.
 *
 * VITE_KERAI_API (build-time) always wins. Without it we derive the host from
 * the page itself — never hardcode localhost — so a production UI served from
 * any host reaches the gateway on the same host:5071. In dev (localhost:5173)
 * this resolves to http://localhost:5071 exactly as before.
 */
function resolveApiBase(): string {
  const override = import.meta.env.VITE_KERAI_API as string | undefined;
  if (override) return override;
  // location.protocol already includes the trailing colon — never write `http:://`.
  const scheme = window.location.protocol === 'https:' ? 'https' : 'http';
  const host = window.location.hostname || 'localhost';
  return `${scheme}://${host}:5071`;
}

const API_BASE = resolveApiBase();

export class ApiError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_TIMEOUT_MS = 8000;

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(`Request to ${path} timed out after ${timeoutMs}ms.`, null);
    }
    throw new ApiError(`Cannot reach KERAI core at ${API_BASE}${path}.`, null);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = (body as { error?: string }).error ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) return undefined as T; // No Content
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  base: API_BASE,

  wsUrl: () => `${API_BASE.replace(/^http/, 'ws')}/ws`,

  health: () => request<HealthStatus>('/health'),

  tools: () => request<ToolContract[]>('/api/tools'),

  ollamaStatus: () => request<OllamaStatus>('/api/ollama/status'),

  systemStatus: () => request<SystemStatus>('/api/system/status'),

  chat: (prompt: string) =>
    request<{ reply: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }, 30000),

  missions: () => request<Mission[]>('/api/missions'),

  createMission: (goal: string, workspacePath?: string, lane?: MissionLane) =>
    request<Mission>('/api/missions', {
      method: 'POST',
      body: JSON.stringify({ goal, workspacePath, lane }),
    }),

  transitionMission: (id: string, status: Mission['status']) =>
    request<Mission>(`/api/missions/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify(status),
    }),

  settings: () => request<KeraiSettings>('/api/settings'),

  updateModel: (model: string) =>
    request<KeraiSettings>('/api/settings/model', {
      method: 'PUT',
      body: JSON.stringify({ model }),
    }),

  updateWorkspace: (root: string) =>
    request<KeraiSettings>('/api/settings/workspace', {
      method: 'PUT',
      body: JSON.stringify({ root }),
    }),

  approvals: (missionId?: string) =>
    request<Approval[]>(`/api/approvals${missionId ? `?missionId=${missionId}` : ''}`),

  approve: (id: string) => request<Approval>(`/api/approvals/${id}/approve`, { method: 'POST' }),

  deny: (id: string) => request<Approval>(`/api/approvals/${id}/deny`, { method: 'POST' }),

  activity: () => request<AgentEvent[]>('/api/activity'),

  automations: () => request<Automation[]>('/api/automations'),

  createAutomation: (input: { label: string; prompt: string; frequency: AutomationFrequency; intervalMinutes?: number; dailyAt?: string }) =>
    request<Automation>('/api/automations', { method: 'POST', body: JSON.stringify(input) }),

  updateAutomation: (id: string, input: Partial<{ label: string; prompt: string; frequency: AutomationFrequency; intervalMinutes: number; dailyAt: string; enabled: boolean }>) =>
    request<Automation>(`/api/automations/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  deleteAutomation: (id: string) => request<unknown>(`/api/automations/${id}`, { method: 'DELETE' }),

  workspace: () => request<WorkspaceSummary>('/api/workspace'),

  memory: () => request<MemorySnapshot>('/api/memory'),

  clearMemory: () => request<MemoryClearResult>('/api/memory', { method: 'DELETE' }),
};
