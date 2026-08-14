import type { AgentEvent } from './types';

export interface ActivityEntry {
  id: string;
  /** Mission the event belongs to. */
  missionId: string;
  /** Raw server event type (e.g. TOOL_COMPLETED). */
  type: string;
  /** Tool name when the event is tool-related. */
  tool?: string;
  title: string;
  detail?: string;
  time: string;
  tone: 'accent' | 'success' | 'warning' | 'error' | 'info';
  /** Display label for the event class. */
  toneLabel: string;
}

/** Friendly labels for the live mission checklist (derived from tool events). */
const TOOL_STEP_LABEL: Record<string, string> = {
  'workspace.inspect': 'Workspace inspected',
  'filesystem.list': 'Directory listed',
  'filesystem.read': 'File read',
  'filesystem.write': 'File written',
  'process.run': 'Command run',
  'dotnet.build': 'Project built',
  'dotnet.test': 'Tests run',
  'git.status': 'Git status checked',
  'git.diff': 'Git diff reviewed',
  'ollama.models': 'Models discovered',
  'submission.dispatch': 'Sub-agent dispatched',
};

export interface ChecklistStep {
  key: string;
  label: string;
  state: 'done' | 'active' | 'error';
}

/**
 * Builds a mission's checklist from its live event stream. Every step maps to a
 * real emitted event — nothing is fabricated.
 */
export function buildChecklist(missionId: string, missionStatus: string, activity: ActivityEntry[]): ChecklistStep[] {
  const events = activity
    .filter(a => a.missionId === missionId)
    .slice()
    .reverse(); // chronological
  const steps: ChecklistStep[] = [];
  const terminal = missionStatus === 'Completed' || missionStatus === 'Failed' || missionStatus === 'Cancelled';

  const add = (key: string, label: string, state: ChecklistStep['state']) => steps.push({ key, label, state });

  if (events.some(e => e.type === 'MISSION_CREATED')) add('created', 'Mission created', 'done');

  const startedIndex = events.findIndex(e => e.type === 'MISSION_STARTED');
  if (startedIndex >= 0) {
    const planningDone = events.slice(startedIndex + 1).some(e => e.type !== 'MISSION_STARTED');
    add('planning', 'Planning started', terminal || planningDone ? 'done' : 'active');
  }

  const toolNames: string[] = [];
  for (const entry of events) {
    if (entry.tool && !toolNames.includes(entry.tool)) toolNames.push(entry.tool);
  }
  for (const name of toolNames) {
    const failed = events.some(e => e.type === 'TOOL_FAILED' && e.tool === name);
    const completed = events.some(e => e.type === 'TOOL_COMPLETED' && e.tool === name);
    add(`tool-${name}`, TOOL_STEP_LABEL[name] ?? name, failed ? 'error' : completed ? 'done' : 'active');
  }

  const verifications = events.filter(e => e.type === 'VERIFICATION');
  if (verifications.length > 0) {
    const last = verifications[verifications.length - 1];
    const failed = /failed/i.test(last.detail ?? '');
    add('verify', failed ? 'Verification failed' : 'Result verified', failed ? 'error' : terminal ? 'done' : 'active');
  }

  if (events.some(e => e.type === 'MISSION_COMPLETED')) add('done', 'Mission completed', 'done');
  else if (events.some(e => e.type === 'MISSION_FAILED')) add('done', 'Mission failed', 'error');
  else if (events.some(e => e.type === 'MISSION_CANCELLED')) add('done', 'Mission cancelled', 'error');

  if (steps.length === 0) add('starting', 'Starting…', 'active');
  return steps;
}

const TONE_LABEL: Record<ActivityEntry['tone'], string> = {
  info: 'INFO',
  success: 'SUCCESS',
  warning: 'WARNING',
  error: 'ERROR',
  accent: 'ACTIVE',
};

interface EventSpec {
  title: string;
  tone: ActivityEntry['tone'];
}

function specFor(type: string): EventSpec {
  switch (type) {
    case 'MISSION_CREATED': return { title: 'Mission created', tone: 'info' };
    case 'MISSION_STARTED': return { title: 'Planning started', tone: 'accent' };
    case 'TOOL_STARTED': return { title: 'Tool started', tone: 'accent' };
    case 'TOOL_COMPLETED': return { title: 'Tool completed', tone: 'success' };
    case 'TOOL_FAILED': return { title: 'Tool failed', tone: 'error' };
    case 'APPROVAL_REQUESTED': return { title: 'Approval requested', tone: 'warning' };
    case 'APPROVAL_GRANTED': return { title: 'Approval granted', tone: 'success' };
    case 'APPROVAL_DENIED': return { title: 'Approval denied', tone: 'error' };
    case 'VERIFICATION': return { title: 'Verifying', tone: 'accent' };
    case 'MISSION_COMPLETED': return { title: 'Mission completed', tone: 'success' };
    case 'MISSION_FAILED': return { title: 'Mission failed', tone: 'error' };
    case 'MISSION_CANCELLED': return { title: 'Mission cancelled', tone: 'warning' };
    default: return { title: type, tone: 'info' };
  }
}

/** Maps a raw server agent event to display form. The message carries the subject (goal, tool name, error). */
export function mapEventToActivity(event: AgentEvent): ActivityEntry {
  const spec = specFor(event.type);
  const tool =
    event.type === 'TOOL_STARTED' || event.type === 'TOOL_COMPLETED'
      ? event.message
      : event.type === 'TOOL_FAILED'
        ? event.message.split(':')[0].trim()
        : undefined;
  return {
    id: `${event.missionId}-${event.type}-${event.occurredAt}`,
    missionId: event.missionId,
    type: event.type,
    tool,
    title: spec.title,
    detail: event.message,
    time: event.occurredAt,
    tone: spec.tone,
    toneLabel: TONE_LABEL[spec.tone],
  };
}
