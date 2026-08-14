import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import type { WorkspaceSummary } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { Icon } from '../components/icons';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspacePage() {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await api.workspace());
      setError(null);
    } catch {
      setError('Failed to inspect the workspace.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Workspace</h1>
          <p className="page__subtitle">The confined root KERAI inspects before it plans. Read-only — nothing here is modified.</p>
        </div>
        <IconButton icon="refresh" label="Refresh workspace" onClick={() => void refresh()} />
      </div>

      {error ? (
        <div className="inline-error">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <Panel eyebrow="Confined root" title={summary?.name ?? 'Workspace'}>
        {summary === null ? (
          <Skeleton height={20} width={320} />
        ) : summary.error ? (
          <EmptyState icon="workspace" title="Workspace unavailable" description={summary.error} />
        ) : (
          <div className="setting-row">
            <div>
              <div className="setting-row__label">{summary.root}</div>
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                {summary.entryCount} entries · {summary.directoryCount} directories · {summary.fileCount} files
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>Change root</Button>
          </div>
        )}
      </Panel>

      <Panel eyebrow="Detection" title="Project signals">
        {summary === null ? (
          <Skeleton height={20} width={200} />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            <Badge tone={summary.hasGit ? 'success' : 'neutral'}>{summary.hasGit ? 'Git repository' : 'No git'}</Badge>
            <Badge tone={summary.hasSolution ? 'success' : 'neutral'}>{summary.hasSolution ? '.NET solution' : 'No .sln'}</Badge>
            {summary.manifests.length > 0 ? summary.manifests.map(m => <Badge key={m} tone="info"><span className="mono">{m}</span></Badge>) : <Badge tone="neutral">No manifests detected</Badge>}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Top level" title="Entries">
        {summary === null ? (
          <div className="model-list"><Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} /></div>
        ) : summary.topEntries.length === 0 ? (
          <EmptyState icon="workspace" title="Empty directory" description="The workspace root contains no entries." />
        ) : (
          <div className="workspace-entries">
            {summary.topEntries.map(entry => (
              <div key={entry.name} className="workspace-entry">
                <Icon name={entry.isDirectory ? 'workspace' : 'file'} size={14} />
                <span className="workspace-entry__name">{entry.name}</span>
                <span className="faint mono" style={{ fontSize: 'var(--text-xs)' }}>
                  {entry.isDirectory ? 'dir' : formatBytes(entry.sizeBytes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
