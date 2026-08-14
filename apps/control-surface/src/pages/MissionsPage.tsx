import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useLive } from '../lib/live';
import { TERMINAL_STATUSES } from '../lib/format';
import type { Mission } from '../lib/types';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { MissionCard } from '../components/mission/MissionCard';
import { Icon } from '../components/icons';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'terminal', label: 'Finished' },
];

export function MissionsPage() {
  const { missions, activity, refresh } = useLive();
  const [filter, setFilter] = useState('all');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { toast } = useToast();

  const cancelMission = async (mission: Mission) => {
    setCancellingId(mission.id);
    try {
      await api.transitionMission(mission.id, 'Cancelled');
      toast('Mission cancelled.');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Failed to cancel mission.', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  const filtered = (missions ?? []).filter(mission => {
    if (filter === 'active') return !TERMINAL_STATUSES.includes(mission.status);
    if (filter === 'terminal') return TERMINAL_STATUSES.includes(mission.status);
    return true;
  });

  const counts = {
    all: missions?.length ?? 0,
    active: missions?.filter(m => !TERMINAL_STATUSES.includes(m.status)).length ?? 0,
    terminal: missions?.filter(m => TERMINAL_STATUSES.includes(m.status)).length ?? 0,
  };

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Missions</h1>
          <p className="page__subtitle">
            {missions ? `${missions.length} total · ${counts.active} active` : 'Connecting…'}
          </p>
        </div>
        <IconButton icon="refresh" label="Refresh missions" onClick={() => void refresh()} />
      </div>

      <Tabs
        items={FILTERS.map(f => ({ id: f.id, label: `${f.label} (${counts[f.id as keyof typeof counts]})` }))}
        selected={filter}
        onSelect={setFilter}
        ariaLabel="Filter missions"
      />

      {missions === null ? (
        <Panel>
          <div className="list-stack">
            <Skeleton height={96} /><Skeleton height={96} /><Skeleton height={96} />
          </div>
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon="mission"
            title={missions.length ? 'No missions in this view' : 'No missions yet'}
            description={
              missions.length
                ? 'Switch the filter to see other missions.'
                : 'Tell KERAI what to accomplish from the Command Center and it will appear here as a mission.'
            }
          />
        </Panel>
      ) : (
        <div className="list-stack">
          {filtered.map(mission => (
            <MissionCard
              key={mission.id}
              mission={mission}
              activity={activity}
              onCancel={cancelMission}
              cancelling={cancellingId === mission.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
