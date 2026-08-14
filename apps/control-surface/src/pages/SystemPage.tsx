import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useLive } from '../lib/live';
import { formatBytes, formatTime, TERMINAL_STATUSES } from '../lib/format';
import type { OllamaStatus, SystemStatus, ToolContract } from '../lib/types';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Panel } from '../components/ui/Panel';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusIndicator } from '../components/ui/StatusIndicator';
import { ToolCard } from '../components/mission/ToolCard';
import { Icon } from '../components/icons';

/**
 * One independently-tracked data source. A failed GPU probe must never look like
 * a dead core — each source reports its own state, reason, and last success.
 */
type SourceState = 'loading' | 'ok' | 'error';

interface Source<T> {
  data: T | null;
  state: SourceState;
  error: string | null;
  lastGood: string | null;
  refresh: () => void;
}

function useSource<T>(fetcher: () => Promise<T>): Source<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<SourceState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastGood, setLastGood] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    fetcherRef.current().then(
      value => {
        if (cancelled) return;
        setData(value);
        setError(null);
        setState('ok');
        setLastGood(new Date().toISOString());
      },
      err => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
        setState('error');
      },
    );
    return () => { cancelled = true; };
  }, [tick]);

  const refresh = useCallback(() => setTick(t => t + 1), []);
  return { data, state, error, lastGood, refresh };
}

type RowState = 'online' | 'offline' | 'warning' | 'error';

function StatusRow({ label, state, detail, lastGood, onRetry }: {
  label: string;
  state: RowState;
  detail?: string | null;
  lastGood?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="source-row">
      <span className="source-row__label">{label}</span>
      <span className="source-row__status">
        <StatusIndicator
          state={state}
          label={state === 'online' ? 'Available' : state === 'warning' ? 'Unavailable' : state === 'error' ? 'Error' : 'Offline'}
        />
      </span>
      <span className="source-row__detail" title={detail ?? undefined}>
        {detail ?? '—'}
      </span>
      <span className="source-row__last">
        {lastGood ? `last success ${formatTime(lastGood)}` : state === 'error' ? 'no successful update yet' : ''}
      </span>
      {onRetry ? (
        <span className="source-row__retry">
          <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>
        </span>
      ) : null}
    </div>
  );
}

export function SystemPage() {
  const { missions } = useLive();
  const telemetry = useSource<SystemStatus>(useCallback(() => api.systemStatus(), []));
  const ollama = useSource<OllamaStatus>(useCallback(() => api.ollamaStatus(), []));
  const tools = useSource<ToolContract[]>(useCallback(() => api.tools(), []));
  const core = useSource<{ status: string }>(useCallback(() => api.health(), []));

  const gpu = telemetry.data?.gpu ?? null;
  const telemetryOk = telemetry.state === 'ok' && telemetry.data !== null;
  const gpuState: RowState = !telemetryOk ? 'warning' : gpu ? 'online' : 'warning';
  const gpuDetail = !telemetryOk
    ? (telemetry.error ?? 'System telemetry unavailable')
    : gpu
      ? gpu.name
      : 'No NVIDIA GPU detected — CPU/RAM/storage still reporting';

  const missionsState = missions === null ? 'loading' as const : 'ok' as const;
  void missionsState;
  const activeMissions = (missions ?? []).filter(m => !TERMINAL_STATUSES.includes(m.status)).length;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">System</h1>
          <p className="page__subtitle">Real machine telemetry — every value from an actual source. Each source reports independently.</p>
        </div>
        <IconButton icon="refresh" label="Refresh all sources" onClick={() => { core.refresh(); telemetry.refresh(); ollama.refresh(); tools.refresh(); }} />
      </div>

      {/* Independent health of every dependency — one failure never hides the rest. */}
      <Panel eyebrow="Source health" title="Status">
        <div className="source-grid">
          <StatusRow label="KERAI CORE" state={core.state === 'ok' ? 'online' : core.state === 'error' ? 'offline' : 'warning'} detail={core.error} lastGood={core.lastGood} onRetry={core.refresh} />
          <StatusRow label="System telemetry" state={telemetry.state === 'ok' ? 'online' : telemetry.state === 'error' ? 'error' : 'warning'} detail={telemetry.error} lastGood={telemetry.lastGood} onRetry={telemetry.refresh} />
          <StatusRow label="GPU telemetry" state={gpuState} detail={gpuDetail} lastGood={telemetryOk ? telemetry.lastGood : null} />
          <StatusRow label="Ollama" state={ollama.state === 'ok' ? (ollama.data?.connected ? 'online' : 'offline') : ollama.state === 'error' ? 'error' : 'warning'} detail={ollama.state === 'ok' ? (ollama.data?.error ?? `${ollama.data?.models.length ?? 0} local models`) : ollama.error} lastGood={ollama.lastGood} onRetry={ollama.refresh} />
          <StatusRow label="Missions" state={missionsState === 'ok' ? 'online' : 'warning'} detail={missionsState === 'ok' ? `${activeMissions} active · ${missions?.length ?? 0} total` : 'Loading mission list'} />
          <StatusRow label="Tools" state={tools.state === 'ok' ? 'online' : tools.state === 'error' ? 'error' : 'warning'} detail={tools.state === 'ok' ? `${tools.data?.length ?? 0} registered` : tools.error} lastGood={tools.lastGood} onRetry={tools.refresh} />
        </div>
      </Panel>

      <Panel eyebrow="Machine" title="Utilization">
        {telemetry.state === 'loading' ? (
          <div className="telemetry-grid"><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={48} /></div>
        ) : telemetry.state === 'error' || !telemetry.data ? (
          <div className="inline-error">
            <Icon name="alert" size={15} />
            <span>System telemetry is unavailable: {telemetry.error}</span>
            <span className="inline-error__retry"><Button variant="secondary" size="sm" onClick={telemetry.refresh}>Retry</Button></span>
          </div>
        ) : (
          <div className="telemetry-grid">
            <div className="telemetry-cell">
              <span className="telemetry-cell__label">CPU</span>
              <span className="telemetry-cell__value">{telemetry.data.cpuPercent}%</span>
              <ProgressBar value={telemetry.data.cpuPercent} ariaLabel="CPU utilization" />
            </div>
            <div className="telemetry-cell">
              <span className="telemetry-cell__label">RAM</span>
              <span className="telemetry-cell__value">{telemetry.data.ramPercent}%</span>
              <span className="telemetry-cell__sub">{formatBytes(telemetry.data.ramUsedBytes)} / {formatBytes(telemetry.data.ramTotalBytes)}</span>
              <ProgressBar value={telemetry.data.ramPercent} ariaLabel="RAM utilization" />
            </div>
            <div className="telemetry-cell">
              <span className="telemetry-cell__label">GPU</span>
              <span className="telemetry-cell__value">
                {telemetry.data.gpu ? `${telemetry.data.gpu.utilizationPercent ?? '—'}%` : '—'}
              </span>
              {telemetry.data.gpu ? (
                <>
                  <span className="telemetry-cell__sub">{telemetry.data.gpu.name}</span>
                  {telemetry.data.gpu.vramPercent != null ? (
                    <ProgressBar value={telemetry.data.gpu.vramPercent} ariaLabel="VRAM utilization" />
                  ) : null}
                </>
              ) : (
                <span className="telemetry-cell__sub telemetry-cell__sub--warn">⚠ No NVIDIA GPU detected</span>
              )}
            </div>
          </div>
        )}
        {telemetry.data?.error ? <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--sp-3)' }}>{telemetry.data.error}</p> : null}
      </Panel>

      <Panel eyebrow="Storage" title="Fixed drives">
        {telemetry.state === 'loading' ? (
          <Skeleton height={72} />
        ) : telemetry.state === 'error' || !telemetry.data ? (
          <div className="inline-error">
            <Icon name="alert" size={15} />
            <span>Storage telemetry is unavailable: {telemetry.error}</span>
          </div>
        ) : (
          <div className="drive-list">
            {telemetry.data.storage.map(drive => (
              <div key={drive.mount} className="drive-row">
                <span className="drive-row__mount mono">{drive.mount}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-1)' }}>
                    <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>
                      {formatBytes(drive.usedBytes)} used of {formatBytes(drive.totalBytes)}
                    </span>
                    <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{drive.percentUsed}%</span>
                  </div>
                  <ProgressBar value={drive.percentUsed} ariaLabel={`${drive.mount} utilization`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Runtime" title="KERAI inventory" footer={<span>Tools and missions come from the KERAI core API.</span>}>
        <div className="metric-row" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="metric"><span className="metric__label">Active missions</span><span className="metric__value">{missionsState === 'ok' ? activeMissions : '—'}</span></div>
          <div className="metric"><span className="metric__label">Tools</span><span className="metric__value">{tools.state === 'ok' ? tools.data?.length : '—'}</span></div>
          <div className="metric"><span className="metric__label">Models</span><span className="metric__value">{ollama.state === 'ok' ? ollama.data?.models.length : '—'}</span></div>
        </div>
        {ollama.state === 'ok' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
            <span className="faint" style={{ fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-wide)' }}>OLLAMA</span>
            <StatusIndicator state={ollama.data?.connected ? 'online' : 'offline'} label={ollama.data?.connected ? 'Connected' : 'Offline'} />
            {ollama.data?.error ? <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>{ollama.data.error}</span> : null}
          </div>
        ) : ollama.state === 'error' ? (
          <div className="inline-error" style={{ marginBottom: 'var(--sp-4)' }}>
            <Icon name="alert" size={15} />
            <span>Ollama unreachable: {ollama.error}</span>
            <span className="inline-error__retry"><Button variant="secondary" size="sm" onClick={ollama.refresh}>Retry</Button></span>
          </div>
        ) : null}
        {tools.state === 'ok' && tools.data?.length ? (
          <div className="tool-grid">
            {tools.data.map(tool => <ToolCard key={tool.name} tool={tool} />)}
          </div>
        ) : null}
        {tools.state === 'loading' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <Skeleton height={64} /><Skeleton height={64} />
          </div>
        ) : null}
        {tools.state === 'error' ? (
          <div className="inline-error">
            <Icon name="alert" size={15} />
            <span>Tool inventory unavailable: {tools.error}</span>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
