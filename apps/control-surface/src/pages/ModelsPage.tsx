import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { KeraiSettings, OllamaStatus } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusIndicator } from '../components/ui/StatusIndicator';
import { useToast } from '../components/ui/Toast';
import { ModelCard } from '../components/mission/ModelCard';
import { Icon } from '../components/icons';

export function ModelsPage() {
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [settings, setSettings] = useState<KeraiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    const [ollamaResult, settingsResult] = await Promise.allSettled([api.ollamaStatus(), api.settings()]);
    if (ollamaResult.status === 'fulfilled') setOllama(ollamaResult.value);
    if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value);
    setError(ollamaResult.status === 'rejected' ? 'Failed to reach Ollama.' : null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectModel = async (name: string) => {
    setBusy(true);
    try {
      const updated = await api.updateModel(name);
      setSettings(updated);
      toast(`Default model set to ${name} — new missions will use it.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update model.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Models</h1>
          <p className="page__subtitle">Local Ollama models, detected dynamically. Selection is the default for all missions.</p>
        </div>
        <IconButton icon="refresh" label="Refresh models" onClick={() => void refresh()} />
      </div>

      <Panel eyebrow="Ollama" title="Connection" footer={<span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{ollama?.endpoint ?? '—'}</span>}>
        {ollama === null && !error ? (
          <Skeleton height={20} width={200} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <StatusIndicator
              state={ollama?.connected ? 'online' : 'offline'}
              label={ollama?.connected ? `Connected · ${ollama.models.length} models` : 'Offline'}
            />
            {ollama?.error ? <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>{ollama.error}</p> : null}
            {settings ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <span className="faint" style={{ fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-wide)' }}>DEFAULT</span>
                <Badge tone={ollama?.models.includes(settings.defaultModel) ? 'accent' : 'warning'}>
                  {settings.defaultModel}
                </Badge>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {error ? (
        <div className="inline-error">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <Panel eyebrow="Installed" title="Available models" actions={settings ? <Badge tone="info">Default drives inference</Badge> : undefined}>
        {ollama === null && !error ? (
          <div className="model-list">
            <Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} />
          </div>
        ) : !ollama?.models.length ? (
          <EmptyState icon="models" title="No models found" description="Pull a model with `ollama pull <name>` and refresh." />
        ) : (
          <div className="model-list">
            {ollama.models.map(name => (
              <ModelCard
                key={name}
                name={name}
                selected={settings?.defaultModel === name}
                onSelect={selectModel}
              />
            ))}
          </div>
        )}
        {busy ? <p className="faint" style={{ fontSize: 'var(--text-xs)' }}>Updating default model…</p> : null}
      </Panel>
    </div>
  );
}
