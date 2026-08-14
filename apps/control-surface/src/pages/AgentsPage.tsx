import { useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useHashRoute, navigate } from '../lib/router';
import { useLive } from '../lib/live';
import { TERMINAL_STATUSES } from '../lib/format';
import type { MissionLane } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CommandInput } from '../components/ui/CommandInput';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon, type IconName } from '../components/icons';
import { useToast } from '../components/ui/Toast';

interface AgentDef {
  id: string;
  name: string;
  icon: IconName;
  description: string;
  lane: MissionLane | null; // null = not yet implemented
  tools: string[];
  placeholder?: string;
  milestone: string;
}

const AGENTS: Record<string, AgentDef> = {
  computer: {
    id: 'computer',
    name: 'Computer Agent',
    icon: 'cpu',
    lane: 'Computer',
    description: 'Operates the machine safely: launches applications, inspects processes, manages windows, opens URLs, and reads/writes the clipboard — always through the permission engine, never a shell. The Master can dispatch sub-missions to this lane.',
    tools: ['open_application', 'close_application', 'list_processes', 'get_active_window', 'focus/minimize/maximize_window', 'open_url', 'get/set_clipboard'],
    placeholder: 'e.g. Open Chrome and open YouTube',
    milestone: 'Phase E',
  },
  coder: {
    id: 'coder',
    name: 'Coder Agent',
    icon: 'code',
    lane: 'Coder',
    description: 'Works inside your workspace: discovers and analyzes projects, searches code, makes controlled edits, runs builds and tests, and verifies results — within the existing workspace security boundary. The Master can dispatch sub-missions to this lane.',
    tools: ['workspace.inspect', 'project.analyze', 'code.search', 'filesystem.read', 'filesystem.write', 'dotnet.build', 'dotnet.test', 'git.status', 'git.diff'],
    placeholder: 'e.g. Find why the build fails and fix it',
    milestone: 'Phase F',
  },
  browser: {
    id: 'browser',
    name: 'Browser Agent',
    icon: 'globe',
    lane: null,
    description: 'Navigates the web under permission: reads pages, extracts information, fills forms, and captures screenshots for verification.',
    tools: ['Navigation', 'Reading pages', 'Forms', 'Extraction', 'Screenshots'],
    milestone: 'Phase G',
  },
};

export function AgentsPage() {
  const [route] = useHashRoute();
  const id = route.split('/')[2] ?? 'computer';
  const agent = AGENTS[id] ?? AGENTS.computer;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">{agent.name}</h1>
          <p className="page__subtitle">Specialist lane — same runtime, scoped tools, identical permissions</p>
        </div>
        {agent.lane ? <Badge tone="success">{agent.lane} lane · live</Badge> : <Badge>Planned · {agent.milestone}</Badge>}
      </div>

      <div className="agent-grid">
        <section className="panel agent-card">
          <div className="agent-card__header">
            <span className="agent-card__icon"><Icon name={agent.icon} size={20} /></span>
            <div>
              <h2 className="agent-card__name">{agent.name}</h2>
              <p className="agent-card__desc">{agent.description}</p>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">Scoped tools</h2>
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {agent.lane
              ? 'Only these tools are offered to the model in this lane. Every call still passes the Tool Registry → Permission Engine → Executor → Verifier chain.'
              : 'Everything this agent does will pass through the existing chain once its tools exist.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            {agent.tools.map(tool => (
              <Badge key={tool} tone={agent.lane ? 'info' : 'neutral'}><span className="mono">{tool}</span></Badge>
            ))}
          </div>
        </section>
      </div>

      {agent.lane ? <LanePanel agent={agent} /> : (
        <section className="panel" style={{ marginTop: 'var(--sp-4)' }}>
          <EmptyState
            icon={agent.icon}
            title={`${agent.name} arrives in ${agent.milestone}`}
            description="Browser tools (navigation, reading, forms, screenshots) are not built yet — the lane contract is defined so they plug into the same pipeline."
          />
        </section>
      )}
    </div>
  );
}

function LanePanel({ agent }: { agent: AgentDef }) {
  const lane = agent.lane!;
  const { missions } = useLive();
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const laneMissions = useMemo(
    () => (missions ?? []).filter(m => m.lane === lane).slice(0, 6),
    [missions, lane],
  );

  const submit = async (goal: string) => {
    setBusy(true);
    try {
      await api.createMission(goal, undefined, lane);
      toast(`${agent.name} mission created — it executes with ${lane}-scoped tools.`);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Failed to create mission.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="panel__header">
        <h2 className="panel__title">Dispatch {agent.name}</h2>
        <Badge tone="accent">{lane} lane</Badge>
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-3)' }}>
        Missions run on the Worker with the {lane} tool allowlist. Writes and system actions still ask for your approval.
      </p>
      <CommandInput
        value={command}
        onChange={setCommand}
        onSubmit={submit}
        busy={busy}
        placeholder={agent.placeholder}
      />
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <h3 className="panel__title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-2)' }}>Recent {lane} missions</h3>
        {laneMissions.length === 0 ? (
          <EmptyState icon={agent.icon} title={`No ${lane} missions yet`} description="Dispatch one above — it runs through the same mission pipeline." />
        ) : (
          <div className="automation-list">
            {laneMissions.map(mission => (
              <div key={mission.id} className="memory-entry">
                <div className="memory-entry__top">
                  <span className="memory-entry__goal">{mission.goal}</span>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                    <Badge tone="accent">{mission.status}</Badge>
                    {TERMINAL_STATUSES.includes(mission.status) ? null : <Button variant="secondary" size="sm" onClick={() => navigate('/missions')}>View</Button>}
                  </div>
                </div>
                {mission.result ? <p className="memory-entry__text">{mission.result.slice(0, 160)}</p> : null}
                <div className="memory-entry__meta">
                  <span className="mono">{mission.id.slice(0, 8)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
