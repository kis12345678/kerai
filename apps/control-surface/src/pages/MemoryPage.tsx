import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatTime, MISSION_STATUS } from '../lib/format';
import type { MemorySnapshot } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { Icon } from '../components/icons';

export function MemoryPage() {
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [clearing, setClearing] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      setMemory(await api.memory());
      setError(null);
    } catch {
      setError('Failed to load memory.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = async () => {
    if (!window.confirm('Forget all finished missions and the entire event trail? Active missions are never touched.')) return;
    setClearing(true);
    try {
      const result = await api.clearMemory();
      toast(`Forgot ${result.missionsCleared} missions, ${result.eventsCleared} events, ${result.approvalsCleared} approvals.`);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to clear memory.', 'error');
    } finally {
      setClearing(false);
    }
  };

  const filteredMissions = useMemo(() => {
    if (!memory) return [];
    const q = query.trim().toLowerCase();
    if (!q) return memory.missions;
    return memory.missions.filter(m => m.goal.toLowerCase().includes(q) || (m.result ?? '').toLowerCase().includes(q));
  }, [memory, query]);

  const filteredEvents = useMemo(() => {
    if (!memory) return [];
    const q = query.trim().toLowerCase();
    if (!q) return memory.events;
    return memory.events.filter(e => e.message.toLowerCase().includes(q) || e.type.toLowerCase().includes(q));
  }, [memory, query]);

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Memory</h1>
          <p className="page__subtitle">Task memory KERAI keeps — inspectable, searchable, and removable. Nothing is stored blindly.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <IconButton icon="refresh" label="Refresh memory" onClick={() => void refresh()} />
          <Button variant="danger" size="sm" onClick={() => void clear()} disabled={clearing}>
            {clearing ? 'Forgetting…' : 'Forget all'}
          </Button>
        </div>
      </div>

      <div style={{ maxWidth: 420 }}>
        <Input label="Search memory" value={query} onChange={e => setQuery(e.target.value)} placeholder="Goals, results, events…" />
      </div>

      {error ? (
        <div className="inline-error">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <Panel eyebrow="Task memory" title={`Missions${memory ? ` · ${memory.missions.length} retained, ${memory.activeMissionCount} active` : ''}`}>
        {memory === null ? (
          <div className="model-list"><Skeleton height={44} /><Skeleton height={44} /></div>
        ) : filteredMissions.length === 0 ? (
          <EmptyState icon="memory" title="No mission memory" description={query ? 'Nothing matches your search.' : 'Completed missions appear here as KERAI finishes them.'} />
        ) : (
          <div className="memory-list">
            {filteredMissions.map(mission => {
              const status = MISSION_STATUS[mission.status];
              return (
                <div key={mission.id} className="memory-entry">
                  <div className="memory-entry__top">
                    <span className="memory-entry__goal">{mission.goal}</span>
                    <Badge tone={status?.tone ?? 'neutral'}>{status?.label ?? mission.status}</Badge>
                  </div>
                  {mission.result ? <p className="memory-entry__text">{mission.result}</p> : null}
                  {mission.error ? <p className="memory-entry__text memory-entry__text--error">{mission.error}</p> : null}
                  <div className="memory-entry__meta">
                    <span>{formatTime(mission.updatedAt)}</span>
                    <span className="mono">{mission.id.slice(0, 8)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Event trail" title={`Activity${memory ? ` · ${memory.events.length} events` : ''}`}>
        {memory === null ? (
          <div className="model-list"><Skeleton height={44} /></div>
        ) : filteredEvents.length === 0 ? (
          <EmptyState icon="activity" title="No events" description={query ? 'Nothing matches your search.' : 'The operational audit trail appears here.'} />
        ) : (
          <div className="memory-list">
            {filteredEvents.slice(0, 100).map(event => (
              <div key={event.missionId + event.type + event.occurredAt} className="memory-entry memory-entry--event">
                <div className="memory-entry__top">
                  <span className="memory-entry__goal">{event.message}</span>
                  <Badge tone="info">{event.type}</Badge>
                </div>
                <div className="memory-entry__meta">
                  <span>{formatTime(event.occurredAt)}</span>
                  <span className="mono">{event.missionId.slice(0, 8)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
