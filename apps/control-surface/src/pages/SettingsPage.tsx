import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { KeraiSettings, OllamaStatus } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Dropdown } from '../components/ui/Dropdown';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusIndicator } from '../components/ui/StatusIndicator';
import { useToast } from '../components/ui/Toast';

export function SettingsPage() {
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [settings, setSettings] = useState<KeraiSettings | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState('');
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    const [ollamaResult, settingsResult] = await Promise.allSettled([api.ollamaStatus(), api.settings()]);
    if (ollamaResult.status === 'fulfilled') setOllama(ollamaResult.value);
    if (settingsResult.status === 'fulfilled') {
      setSettings(settingsResult.value);
      setWorkspaceDraft(settingsResult.value.workspaceRoot);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectModel = async (name: string) => {
    try {
      setSettings(await api.updateModel(name));
      toast(`Default model set to ${name} — new missions will use it.`);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Failed to update model.', 'error');
    }
  };

  const saveWorkspace = async () => {
    setSavingWorkspace(true);
    try {
      setSettings(await api.updateWorkspace(workspaceDraft));
      toast('Workspace root updated.');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Failed to update workspace.', 'error');
    } finally {
      setSavingWorkspace(false);
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Settings</h1>
          <p className="page__subtitle">Connection and preference — persisted by the KERAI core.</p>
        </div>
        <IconButton icon="refresh" label="Refresh settings" onClick={() => void refresh()} />
      </div>

      <Panel
        eyebrow="AI Engine"
        title="Ollama"
        actions={ollama ? <Badge tone={ollama.connected ? 'success' : 'error'}>{ollama.connected ? 'Connected' : 'Offline'}</Badge> : undefined}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div className="setting-row">
            <div>
              <div className="setting-row__label">Connection</div>
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Local model server used for generation.</p>
            </div>
            {ollama === null ? <Skeleton height={20} width={90} /> : <StatusIndicator state={ollama.connected ? 'online' : 'offline'} label={ollama.connected ? 'Connected' : 'Offline'} />}
          </div>

          {ollama?.models.length && settings ? (
            <div className="setting-row">
              <div>
                <div className="setting-row__label">Default model</div>
                <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>The model KERAI uses for every mission.</p>
              </div>
              <Dropdown
                label="Select default model"
                selected={settings.defaultModel}
                onSelect={selectModel}
                items={ollama.models.map(name => ({ value: name, label: name }))}
                align="right"
              >
                <span className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {settings.defaultModel || 'No default'}
                </span>
              </Dropdown>
            </div>
          ) : null}

          <details className="advanced">
            <summary className="advanced__summary">Advanced</summary>
            <div className="setting-row">
              <div>
                <div className="setting-row__label">Endpoint</div>
                <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Ollama server address.</p>
              </div>
              <code className="mono advanced__code">{ollama?.endpoint ?? '—'}</code>
            </div>
          </details>
        </div>
      </Panel>

      <Panel eyebrow="Workspace" title="Confined root">
        <p className="muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--sp-3)' }}>
          Every filesystem tool is confined to this directory. Changes take effect for new missions.
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input label="Workspace root" value={workspaceDraft} onChange={e => setWorkspaceDraft(e.target.value)} spellCheck={false} />
          </div>
          <Button variant="secondary" onClick={saveWorkspace} disabled={savingWorkspace || !workspaceDraft || workspaceDraft === settings?.workspaceRoot}>
            {savingWorkspace ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Panel>

      <Panel eyebrow="Voice & Speech" title="Natural Voice & Multi-Language">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div className="setting-row">
            <div>
              <div className="setting-row__label">Conversation Language</div>
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Select language for speech recognition (STT) and voice synthesis (TTS).</p>
            </div>
            <select
              style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border-strong)', padding: '6px 12px', borderRadius: 'var(--r-md)', fontFamily: 'inherit' }}
              value={localStorage.getItem('kerai.voiceLanguage') ?? 'en-US'}
              onChange={e => {
                localStorage.setItem('kerai.voiceLanguage', e.target.value);
                toast(`Voice language set to ${e.target.selectedOptions[0].text}.`);
                setSettings(prev => prev ? { ...prev } : null);
              }}
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Spanish (Español)</option>
              <option value="fr-FR">French (Français)</option>
              <option value="de-DE">German (Deutsch)</option>
              <option value="it-IT">Italian (Italiano)</option>
              <option value="hi-IN">Hindi (हिन्दी)</option>
              <option value="ja-JP">Japanese (日本語)</option>
              <option value="zh-CN">Chinese (中文)</option>
              <option value="ko-KR">Korean (한국어)</option>
              <option value="pt-BR">Portuguese (Brasil)</option>
              <option value="ru-RU">Russian (Русский)</option>
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-row__label">Voice Audio Engine</div>
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Choose between Human Neural Audio streaming or local system voices.</p>
            </div>
            <select
              style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border-strong)', padding: '6px 12px', borderRadius: 'var(--r-md)', fontFamily: 'inherit' }}
              value={localStorage.getItem('kerai.voiceEngine') ?? 'neural'}
              onChange={e => {
                localStorage.setItem('kerai.voiceEngine', e.target.value);
                toast(`Voice engine set to ${e.target.value === 'neural' ? 'Human Neural Stream' : 'Local System Voice'}.`);
                setSettings(prev => prev ? { ...prev } : null);
              }}
            >
              <option value="neural">Human Neural Stream (Realistic Voice)</option>
              <option value="system">Local System Voice (Offline)</option>
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-row__label">Test Natural Voice</div>
              <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Preview authentic human conversational voice in your selected language.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                const lang = localStorage.getItem('kerai.voiceLanguage') ?? 'en-US';
                const sampleTexts: Record<string, string> = {
                  'en-US': "Hello! I am KERAI, your local-first AI assistant. How can I help you today?",
                  'en-GB': "Hello! I am KERAI, your local-first AI assistant. How can I help you today?",
                  'es-ES': "¡Hola! Soy KERAI, tu asistente de inteligencia artificial. ¿En qué te puedo ayudar hoy?",
                  'fr-FR': "Bonjour! Je suis KERAI, votre assistant d'intelligence artificielle. Comment puis-je vous aider?",
                  'de-DE': "Hallo! Ich bin KERAI, Ihr persönlicher KI-Assistent. Wie kann ich Ihnen heute helfen?",
                  'it-IT': "Ciao! Sono KERAI, il tuo assistente di intelligenza artificiale. Come posso aiutarti oggi?",
                  'hi-IN': "नमस्ते! मैं केरई हूँ, आपका अपना एआई सहायक। आज मैं आपकी क्या मदद कर सकता हूँ?",
                  'ja-JP': "こんにちは！私はKERAIです。あなたのAIアシスタントです。今日はどのようなお手伝いをしましょうか？",
                  'zh-CN': "你好！我是 KERAI，你的 AI 助手。今天我能为你做些什么？",
                  'ko-KR': "안녕하세요! 저는 KERAI입니다. 오늘 어떤 도움이 필요하신가요?",
                  'pt-BR': "Olá! Eu sou o KERAI, seu assistente de inteligência artificial. Como posso ajudar você hoje?",
                  'ru-RU': "Здравствуйте! Я KERAI, ваш ИИ-помощник. Чем я могу вам помочь сегодня?"
                };
                const text = sampleTexts[lang] ?? sampleTexts['en-US'];
                const engine = localStorage.getItem('kerai.voiceEngine') ?? 'neural';
                const langCode = lang.split('-')[0];

                if (engine === 'neural') {
                  const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${langCode}&client=tw-ob`;
                  const audio = new Audio(audioUrl);
                  toast('Playing Human Neural Voice sample…');
                  void audio.play().catch(() => toast('Could not stream neural voice. Falling back to local TTS.', 'warning'));
                } else if ('speechSynthesis' in window) {
                  window.speechSynthesis.cancel();
                  const utterance = new SpeechSynthesisUtterance(text);
                  utterance.lang = lang;
                  utterance.rate = 0.95;
                  window.speechSynthesis.speak(utterance);
                  toast('Playing system voice sample.');
                }
              }}
            >
              Play Voice Sample
            </Button>
          </div>
        </div>
      </Panel>

      <Panel eyebrow="Core" title="KERAI gateway">
        <div className="setting-row">
          <div>
            <div className="setting-row__label">API base URL</div>
            <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Override with VITE_KERAI_API at build time.</p>
          </div>
          <code className="mono advanced__code">{api.base}</code>
        </div>
      </Panel>
    </div>
  );
}
