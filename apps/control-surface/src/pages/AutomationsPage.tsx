import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatTime } from '../lib/format';
import type { Automation, AutomationFrequency } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { Icon } from '../components/icons';

function scheduleLabel(a: Automation): string {
  if (!a.enabled) return 'Paused';
  return a.frequency === 'Interval'
    ? `Every ${a.intervalMinutes} min`
    : `Daily at ${a.dailyAt}`;
}

export function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [frequency, setFrequency] = useState<AutomationFrequency>('Interval');
  const [intervalMinutes, setIntervalMinutes] = useState('30');
  const [dailyAt, setDailyAt] = useState('09:00');

  const refresh = useCallback(async () => {
    try {
      setAutomations(await api.automations());
      setError(null);
    } catch {
      setError('Failed to load automations.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const create = async () => {
    if (!label.trim() || !prompt.trim()) {
      toast('Label and prompt are required.', 'warning');
      return;
    }
    setBusy(true);
    try {
      await api.createAutomation({
        label,
        prompt,
        frequency,
        intervalMinutes: frequency === 'Interval' ? Math.max(1, parseInt(intervalMinutes, 10) || 1) : undefined,
        dailyAt: frequency === 'Daily' ? dailyAt : undefined,
      });
      setLabel('');
      setPrompt('');
      toast('Automation created — it fires as a normal mission that still needs your approval for privileged actions.');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create automation.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (automation: Automation) => {
    try {
      await api.updateAutomation(automation.id, { enabled: !automation.enabled });
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update automation.', 'error');
    }
  };

  const remove = async (automation: Automation) => {
    if (!window.confirm(`Delete automation "${automation.label}"?`)) return;
    try {
      await api.deleteAutomation(automation.id);
      toast('Automation deleted.');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to delete automation.', 'error');
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Automations</h1>
          <p className="page__subtitle">Scheduled missions. Firing only creates a normal mission — approvals still apply, always.</p>
        </div>
        <IconButton icon="refresh" label="Refresh automations" onClick={() => void refresh()} />
      </div>

      <Panel eyebrow="New automation" title="Schedule a mission">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <Input label="Label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Morning health check" />
          <Input
            label="Prompt"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="What should KERAI accomplish, e.g. 'Check system status and summarize'"
          />
          <div className="setting-row" style={{ alignItems: 'flex-end' }}>
            <div>
              <div className="setting-row__label">Frequency</div>
              <div className="automation-freq">
                <button
                  type="button"
                  className={`automation-freq__option${frequency === 'Interval' ? ' automation-freq__option--active' : ''}`}
                  onClick={() => setFrequency('Interval')}
                >
                  Every N minutes
                </button>
                <button
                  type="button"
                  className={`automation-freq__option${frequency === 'Daily' ? ' automation-freq__option--active' : ''}`}
                  onClick={() => setFrequency('Daily')}
                >
                  Daily at a time
                </button>
              </div>
            </div>
            {frequency === 'Interval' ? (
              <Input label="Interval (minutes)" value={intervalMinutes} onChange={e => setIntervalMinutes(e.target.value)} type="number" min={1} style={{ width: 150 }} />
            ) : (
              <Input label="Time (24h)" value={dailyAt} onChange={e => setDailyAt(e.target.value)} placeholder="09:00" style={{ width: 150 }} />
            )}
          </div>
          <div>
            <Button variant="primary" onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create automation'}
            </Button>
          </div>
        </div>
      </Panel>

      {error ? (
        <div className="inline-error">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <Panel eyebrow="Scheduled" title="Active & paused">
        {automations === null ? (
          <div className="model-list">
            <Skeleton height={44} /><Skeleton height={44} />
          </div>
        ) : automations.length === 0 ? (
          <EmptyState
            icon="automations"
            title="No automations yet"
            description="Create one above — KERAI will fire it as a mission through the normal permission pipeline."
          />
        ) : (
          <div className="automation-list">
            {automations.map(automation => (
              <div key={automation.id} className="automation-card">
                <div className="automation-card__main">
                  <div className="automation-card__top">
                    <span className="automation-card__label">{automation.label}</span>
                    <Badge tone={automation.enabled ? 'success' : 'neutral'}>{scheduleLabel(automation)}</Badge>
                  </div>
                  <p className="automation-card__prompt">{automation.prompt}</p>
                  <div className="automation-card__meta">
                    <span>Created {formatTime(automation.createdAt)}</span>
                    {automation.lastFiredAt ? <span>Last fired {formatTime(automation.lastFiredAt)}</span> : null}
                    <span>{automation.missionCount} mission{automation.missionCount === 1 ? '' : 's'} fired</span>
                  </div>
                </div>
                <div className="automation-card__actions">
                  <Button variant="secondary" size="sm" onClick={() => void toggle(automation)}>
                    {automation.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void remove(automation)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
