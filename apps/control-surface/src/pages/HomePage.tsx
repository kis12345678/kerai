import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classifyInput } from '../lib/brain';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { useLive } from '../lib/live';
import { formatTime, TERMINAL_STATUSES, MISSION_STATUS } from '../lib/format';
import { NEURAL_STATE_LABEL, type NeuralCoreState } from '../lib/neural';
import type { NeuralAudioDrive } from '../lib/neural';
import { NO_AUDIO_DRIVE } from '../lib/neural';
import { VoiceController, type VoiceStatus } from '../lib/voice';
import type { Approval, KeraiSettings, Mission, MissionLane, OllamaStatus } from '../lib/types';
import { CommandInput } from '../components/ui/CommandInput';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { StatusIndicator } from '../components/ui/StatusIndicator';
import { useToast } from '../components/ui/Toast';
import { Icon, type IconName } from '../components/icons';
import { KeraiNeuralCore } from '../components/core/KeraiNeuralCore';

const POLL_MS = 15_000;
const VOICE_REPLIES_KEY = 'kerai.voiceReplies';

interface QuickAction {
  icon: IconName;
  label: string;
  run: () => void;
}

export function HomePage({ focusSignal = 0 }: { focusSignal?: number }) {
  const { missions, approvals } = useLive();
  const [command, setCommand] = useState('');
  const [creating, setCreating] = useState(false);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [settings, setSettings] = useState<KeraiSettings | null>(null);
  const [coreOnline, setCoreOnline] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceDrive, setVoiceDrive] = useState<NeuralAudioDrive>({ ...NO_AUDIO_DRIVE });
  const [voiceReplies, setVoiceReplies] = useState(() => localStorage.getItem(VOICE_REPLIES_KEY) === '1');
  const [chatReply, setChatReply] = useState<string | null>(null);
  const chatReplyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const spokenMissions = useRef(new Set<string>());
  const { toast } = useToast();

  /* Phase C voice — one controller for mic + STT + TTS. */
  const voiceRef = useRef<VoiceController | null>(null);
  const handlersRef = useRef({ onTranscript: (_text: string) => {}, onError: (_message: string) => {} });
  if (!voiceRef.current) {
    voiceRef.current = new VoiceController({
      onDrive: drive => setVoiceDrive(drive),
      onTranscript: text => handlersRef.current.onTranscript(text),
      onStatusChange: status => setVoiceStatus(status),
      onError: message => handlersRef.current.onError(message),
    });
  }
  const voice = voiceRef.current;

  const refresh = useCallback(async () => {
    const [healthResult, settingsResult, ollamaResult] = await Promise.allSettled([api.health(), api.settings(), api.ollamaStatus()]);
    setCoreOnline(healthResult.status === 'fulfilled');
    if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value);
    if (ollamaResult.status === 'fulfilled') setOllama(ollamaResult.value);
    setLoadError(
      [healthResult, settingsResult, ollamaResult].some(r => r.status === 'rejected')
        ? 'Some sources are unreachable — see the System page for per-source status.'
        : null,
    );
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  const showChatReply = useCallback((text: string) => {
    setChatReply(text);
    if (chatReplyTimer.current) clearTimeout(chatReplyTimer.current);
    chatReplyTimer.current = setTimeout(() => setChatReply(null), 15000);
  }, []);

  const createMission = async (goal: string, lane?: MissionLane) => {
    setCreating(true);
    try {
      await api.createMission(goal, undefined, lane);
      setCommand('');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Failed to create mission.', 'error');
    } finally {
      setCreating(false);
    }
  };

  /**
   * Smart router — uses KERAI's brain to distinguish conversation from action.
   * Chat inputs get an instant reply (and spoken if voice is on).
   * Real tasks are dispatched to the mission pipeline silently.
   */
  const handleInput = useCallback(
    async (raw: string, lane?: MissionLane) => {
      const text = raw.trim();
      if (!text) return;
      if (lane) {
        // Quick-action buttons always go straight to missions
        void createMission(text, lane);
        return;
      }
      const { kind, reply } = classifyInput(text);
      if (kind === 'chat') {
        setCommand('');
        if (reply) {
          showChatReply(reply);
          if (voiceReplies && voice.ttsAvailable) {
            void voice.speak(reply);
          }
        } else {
          showChatReply('KERAI is thinking…');
          try {
            const res = await api.chat(text);
            showChatReply(res.reply);
            if (voiceReplies && voice.ttsAvailable) {
              void voice.speak(res.reply);
            }
          } catch {
            showChatReply("I'm here — how can I help you?");
          }
        }
      } else {
        void createMission(text);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showChatReply, voiceReplies, voice],
  );

  const cancelMission = async (mission: Mission) => {
    try {
      await api.transitionMission(mission.id, 'Cancelled');
      toast('Mission cancelled.');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Failed to cancel mission.', 'error');
    }
  };

  handlersRef.current.onTranscript = (text) => {
    setCommand(text);
    handleInput(text);
  };
  handlersRef.current.onError = (message) => toast(message, 'warning');

  const toggleListening = async () => {
    if (voiceStatus === 'listening') {
      voice.stopListening();
      return;
    }
    if (voiceStatus === 'speaking') voice.stopSpeaking();
    const started = await voice.startListening();
    if (started) {
      toast(voice.sttAvailable ? 'Listening — speak your request.' : 'Listening — mic drives the Neural Core; speech-to-text is unavailable in this browser.');
    }
  };

  const toggleVoiceReplies = () => {
    const next = !voiceReplies;
    setVoiceReplies(next);
    localStorage.setItem(VOICE_REPLIES_KEY, next ? '1' : '0');
    toast(next ? 'Voice replies on — KERAI will speak mission results.' : 'Voice replies off.');
  };

  /* Speak completed/failed mission results when voice replies are on. */
  useEffect(() => {
    if (!voiceReplies || !voice.ttsAvailable || !missions) return;
    const recent = missions.filter(m => TERMINAL_STATUSES.includes(m.status) && !spokenMissions.current.has(m.id));
    for (const mission of recent) {
      spokenMissions.current.add(mission.id);
      const text = mission.result ?? mission.error;
      if (text) voice.speak(text.length > 260 ? `${text.slice(0, 260)}…` : text);
    }
  }, [missions, voiceReplies, voice]);

  useEffect(() => () => voice.dispose(), [voice]);

  const activeMissions = useMemo(
    () =>
      (missions ?? [])
        .filter(m => !TERMINAL_STATUSES.includes(m.status))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [missions],
  );
  const currentMission = activeMissions[0];
  const lastMission = useMemo(() => (missions && missions.length > 0 ? missions[0] : undefined), [missions]);
  const pendingApproval = useMemo(
    () => approvals.find(a => a.missionId === currentMission?.id && a.status === 'Pending'),
    [approvals, currentMission],
  );

  const coreState: NeuralCoreState =
    voiceStatus === 'speaking'
      ? 'speaking'
      : voiceStatus === 'listening'
        ? 'listening'
        : currentMission?.status === 'WaitingForApproval'
          ? 'waitingApproval'
          : currentMission?.status === 'Running' || currentMission?.status === 'Verifying'
            ? 'executing'
            : currentMission?.status === 'Created'
              ? 'thinking'
              : currentMission?.status === 'Failed'
                ? 'error'
                : 'idle';

  const coreCaption =
    currentMission && coreState !== 'idle' && voiceStatus === 'idle'
      ? `${NEURAL_STATE_LABEL[coreState]} · ${currentMission.goal}`
      : NEURAL_STATE_LABEL[coreState];

  const coreStateIndicator = coreOnline === null ? 'CONNECTING' : coreOnline ? 'KERAI READY' : 'CORE OFFLINE';

  const quickActions: QuickAction[] = [
    { icon: 'cpu', label: 'Open Chrome', run: () => void createMission('Open Chrome.', 'Computer') },
    { icon: 'code', label: 'Open VS Code', run: () => void createMission('Open VS Code.', 'Computer') },
    { icon: 'workspace', label: 'Analyze Project', run: () => void createMission('Analyze this project: build system, structure, and how it builds.', 'Coder') },
    { icon: 'system', label: 'Check System', run: () => navigate('/system') },
  ];

  const [handsFree, setHandsFree] = useState(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('kerai.handsFree') : null;
    return stored === null ? true : stored === '1';
  });

  useEffect(() => {
    voice.setHandsFreeMode(handsFree);
    if (handsFree && voice.currentStatus === 'idle') {
      const timer = setTimeout(() => {
        void voice.startListening();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [handsFree, voice]);

  const toggleHandsFree = () => {
    const next = !handsFree;
    setHandsFree(next);
    localStorage.setItem('kerai.handsFree', next ? '1' : '0');
    voice.setHandsFreeMode(next);
    if (next) {
      void voice.startListening();
      toast('Always-Listening Hands-Free Mode activated — speak anytime!');
    } else {
      voice.stopListening();
      toast('Hands-Free mode off.');
    }
  };

  const contextRows: { icon: IconName; label: string; value: string; to: string }[] = [
    { icon: 'workspace', label: 'Workspace', value: settings?.workspaceRoot ?? 'Not set', to: '/workspace' },
    {
      icon: 'mission',
      label: 'Active Mission',
      value: currentMission ? currentMission.goal : 'None',
      to: '/missions',
    },
    { icon: 'models', label: 'Model', value: settings?.defaultModel ?? 'Not set', to: '/models' },
    { icon: 'sparkles', label: 'Screen Vision', value: 'Active (computer.screenshot)', to: '/system' },
    { icon: 'search', label: 'Web Research', value: 'Active (web.search & fetch)', to: '/system' },
  ];

  return (
    <div className="page home">
      <div className="home__main">
        <div className="home__presence">
          <div className="home__core-wrap">
            <KeraiNeuralCore state={coreState} drive={voiceDrive} className="home__core" />
          </div>
          <p className="home__caption" aria-live="polite">{coreCaption}</p>
          <h1 className="home__greeting">How can I help you?</h1>
        </div>

        <div className="home__input">
          {chatReply && (
            <div className="home__chat-reply" role="status" aria-live="polite">
              <span className="home__chat-reply-dot" />
              <span style={{ flex: 1 }}>{chatReply}</span>
              <button
                type="button"
                className="home__chat-reply-close"
                onClick={() => setChatReply(null)}
                aria-label="Dismiss message"
                title="Dismiss"
                style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', padding: '0 4px', fontSize: '14px', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          )}

          <CommandInput
            value={command}
            onChange={setCommand}
            onSubmit={goal => handleInput(goal)}
            busy={creating}
            inputRef={inputRef}
            placeholder="Say anything — ask a question or give a command…"
            hint={
              <>
                <span><span className="kbd">↵</span> submit</span>
                <span><span className="kbd">⇧↵</span> new line</span>
                <span><span className="kbd">esc</span> clear</span>
                <span><span className="kbd">⌘K</span> focus</span>
              </>
            }
            trailing={
              <>
                <button
                  type="button"
                  className={`command-input__mic ${handsFree ? 'command-input__mic--active' : ''}`}
                  onClick={toggleHandsFree}
                  aria-label={handsFree ? 'JARVIS Hands-Free active' : 'Turn on JARVIS Hands-Free mode'}
                  title={handsFree ? 'JARVIS Hands-Free active — continuous listening' : 'Turn on JARVIS Hands-Free mode'}
                >
                  <Icon name="sparkles" size={16} />
                </button>
                <button
                  type="button"
                  className={`command-input__mic${voiceStatus === 'listening' ? ' command-input__mic--active' : ''}`}
                  onClick={() => void toggleListening()}
                  aria-label={voiceStatus === 'listening' ? 'Stop listening' : 'Talk to KERAI'}
                  title={voiceStatus === 'listening' ? 'Listening — click to stop' : 'Talk to KERAI'}
                >
                  <Icon name="mic" size={16} />
                </button>
                <button
                  type="button"
                  className={`command-input__mic ${voiceReplies ? 'command-input__mic--active' : ''}`}
                  onClick={toggleVoiceReplies}
                  aria-label={voiceReplies ? 'Voice replies on' : 'Voice replies off'}
                  title={voiceReplies ? 'Voice replies on — KERAI speaks results' : 'Voice replies off'}
                >
                  <Icon name="volume" size={16} />
                </button>
              </>
            }
          />
        </div>

        {loadError ? (
          <div className="inline-error">
            <Icon name="alert" size={15} />
            <span>{loadError}</span>
            <span className="inline-error__retry">
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>Retry</Button>
            </span>
          </div>
        ) : null}

        <div className="home__mission">
          {currentMission ? (
            <MissionControl
              mission={currentMission}
              pendingApproval={pendingApproval}
              approvingId={approvingId}
              onStop={cancelMission}
              onApproval={respondToApproval}
              onView={() => navigate('/missions')}
            />
          ) : lastMission ? (
            <LastResult mission={lastMission} onView={() => navigate('/missions')} />
          ) : (
            <p className="home__idle">No active mission. Your workspace and local AI are ready — tell KERAI what to accomplish.</p>
          )}
        </div>
      </div>

      <aside className="home__rail">
        <section className="panel home-rail-panel">
          <h2 className="panel__title">Current Context</h2>
          <div className="context-list">
            {contextRows.map(row => (
              <button key={row.label} type="button" className="context-row" onClick={() => navigate(row.to)}>
                <Icon name={row.icon} size={14} />
                <span className="context-row__copy">
                  <span className="context-row__label">{row.label}</span>
                  <span className="context-row__value">{row.value}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel home-rail-panel">
          <h2 className="panel__title">Quick Actions</h2>
          <div className="quick-actions">
            {quickActions.map(action => (
              <button key={action.label} type="button" className="quick-action" onClick={action.run}>
                <Icon name={action.icon} size={14} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel home-rail-panel">
          <div className="voice-status__header">
            <h2 className="panel__title">Voice Status</h2>
            <Badge tone={voiceStatus === 'idle' ? 'neutral' : 'accent'}>{voiceLabel(voiceStatus, coreState)}</Badge>
          </div>
          <VoiceWaveform level={voiceLevel(voiceStatus, voiceDrive)} active={voiceStatus === 'listening' || voiceStatus === 'speaking'} />
          <div className="voice-status__actions">
            <Button variant={voiceStatus === 'listening' ? 'danger' : 'secondary'} size="sm" onClick={() => void toggleListening()}>
              {voiceStatus === 'listening' ? 'Stop listening' : 'Talk to KERAI'}
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleVoiceReplies}>
              {voiceReplies ? 'Voice replies on' : 'Voice replies off'}
            </Button>
          </div>
        </section>
      </aside>
    </div>
  );

  async function respondToApproval(approval: Approval, granted: boolean) {
    setApprovingId(approval.id);
    try {
      if (granted) {
        await api.approve(approval.id);
        toast('Approval granted — mission resumes.');
      } else {
        await api.deny(approval.id);
        toast('Approval denied — mission stopped.', 'warning');
      }
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Failed to update approval.', 'error');
    } finally {
      setApprovingId(null);
    }
  }
}

function voiceLabel(status: VoiceStatus, state: NeuralCoreState): string {
  if (status === 'listening') return 'LISTENING';
  if (status === 'speaking') return 'SPEAKING';
  switch (state) {
    case 'thinking': return 'THINKING';
    case 'executing': return 'EXECUTING';
    case 'waitingApproval': return 'WAITING FOR APPROVAL';
    case 'error': return 'ERROR';
    default: return 'READY';
  }
}

/** 0..1 amplitude driving the waveform: real audio while active, calm shimmer idle. */
function voiceLevel(status: VoiceStatus, drive: NeuralAudioDrive): number {
  if (status === 'listening' || status === 'speaking') {
    return Math.min(1, (drive.scale + drive.density) / 2 + 0.18);
  }
  return 0.12; // idle shimmer baseline
}

/** Small live waveform — bars follow the real audio level, rAF-driven, no canvas. */
function VoiceWaveform({ level, active }: { level: number; active: boolean }) {
  const barsRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const container = barsRef.current;
    if (!container) return;
    const bars = Array.from(container.querySelectorAll<HTMLElement>('.voice-wave__bar'));
    let raf = 0;
    let last = performance.now();
    let smooth = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const target = levelRef.current + Math.sin(now / 320) * 0.02;
      smooth += (target - smooth) * (1 - Math.exp(-dt * 6));
      for (let i = 0; i < bars.length; i++) {
        const seed = 0.5 + 0.5 * Math.sin(now / 180 + i * 2.4);
        const height = Math.max(0.06, smooth * (0.45 + 0.85 * seed));
        bars[i].style.transform = `scaleY(${height})`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={barsRef} className={`voice-wave${active ? ' voice-wave--active' : ''}`} aria-hidden="true">
      {Array.from({ length: 21 }, (_, i) => <span key={i} className="voice-wave__bar" />)}
    </div>
  );
}

/* ---------- Mission panel (compact presence surface) ---------- */

function MissionControl({
  mission,
  pendingApproval,
  approvingId,
  onStop,
  onApproval,
  onView,
}: {
  mission: Mission;
  pendingApproval?: Approval;
  approvingId: string | null;
  onStop: (mission: Mission) => void;
  onApproval: (approval: Approval, granted: boolean) => void;
  onView: () => void;
}) {
  const status = MISSION_STATUS[mission.status] ?? { label: mission.status, tone: 'accent' as const };
  const inProgress = mission.status === 'Running' || mission.status === 'Verifying';

  return (
    <div className="mission-control">
      <div className="mission-control__top">
        <div style={{ minWidth: 0 }}>
          <div className="mission-control__goal">{mission.goal}</div>
          <div className="mission-control__meta">
            <span>{formatTime(mission.createdAt)}</span>
            <span className="mono">{mission.id.slice(0, 8)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          {mission.lane && mission.lane !== 'Master' ? <Badge tone="info">{mission.lane}</Badge> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>

      {inProgress ? <ProgressBar ariaLabel="Mission in progress" /> : null}

      {pendingApproval ? (
        <div className="approval-row">
          <div>
            <span className="approval-row__title">Approval required</span>
            <span className="approval-row__detail mono">{pendingApproval.toolName}</span>
          </div>
          <div className="approval-row__actions">
            <Button variant="ghost" size="sm" disabled={approvingId === pendingApproval.id} onClick={() => onApproval(pendingApproval, false)}>
              Deny
            </Button>
            <Button variant="primary" size="sm" disabled={approvingId === pendingApproval.id} onClick={() => onApproval(pendingApproval, true)}>
              Approve
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mission-control__actions">
        <Button variant="secondary" size="sm" onClick={onView}>View Mission</Button>
        {mission.status !== 'WaitingForApproval' ? (
          <Button variant="danger" size="sm" onClick={() => onStop(mission)}>Stop mission</Button>
        ) : null}
      </div>
    </div>
  );
}

function LastResult({ mission, onView }: { mission: Mission; onView: () => void }) {
  const text = mission.result ?? mission.error;
  const failed = mission.status === 'Failed' || mission.status === 'Cancelled';
  return (
    <div className="last-result">
      <div className="last-result__top">
        <div style={{ minWidth: 0 }}>
          <div className="last-result__goal">{mission.goal}</div>
          <div className="mission-control__meta">
            <span>{formatTime(mission.updatedAt)}</span>
            <span className="mono">{mission.id.slice(0, 8)}</span>
          </div>
        </div>
        <Badge tone={failed ? 'error' : 'success'}>{MISSION_STATUS[mission.status]?.label ?? mission.status}</Badge>
      </div>
      {text ? <div className={`last-result__text ${failed ? 'last-result__text--error' : ''}`}>{text}</div> : null}
      <div className="mission-control__actions">
        <Button variant="secondary" size="sm" onClick={onView}>View Mission</Button>
      </div>
    </div>
  );
}
