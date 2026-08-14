import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useLive } from '../lib/live';
import { MISSION_STATUS, TERMINAL_STATUSES, formatTime } from '../lib/format';
import type { Mission } from '../lib/types';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Tabs } from '../components/ui/Tabs';
import { Icon } from '../components/icons';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
];

/**
 * The conversation is KERAI's real interaction history: every mission's goal is
 * the user's request and its result is KERAI's reply. No fabricated dialogue —
 * this is the same data as Missions, framed as a conversation.
 */
export function ChatPage() {
  const { missions } = useLive();
  const [filter, setFilter] = useState('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const threads = useMemo(() => {
    const list = (missions ?? []).filter(mission => {
      if (filter === 'active') return !TERMINAL_STATUSES.includes(mission.status);
      return true;
    });
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [missions, filter]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [threads.length]);

  const counts = {
    all: missions?.length ?? 0,
    active: missions?.filter(m => !TERMINAL_STATUSES.includes(m.status)).length ?? 0,
  };

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Chat</h1>
          <p className="page__subtitle">
            {missions ? `Your conversation with KERAI · ${counts.active} active` : 'Connecting…'}
          </p>
        </div>
      </div>

      <Tabs
        items={FILTERS.map(f => ({ id: f.id, label: `${f.label} (${counts[f.id as keyof typeof counts]})` }))}
        selected={filter}
        onSelect={setFilter}
        ariaLabel="Filter conversation"
      />

      <section className="panel chat-thread">
        <div className="chat-thread__scroll" ref={scrollRef}>
          {missions === null ? (
            <div style={{ padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <Skeleton height={48} /><Skeleton height={80} /><Skeleton height={48} />
            </div>
          ) : threads.length === 0 ? (
            <EmptyState
              icon="chat"
              title={missions.length ? 'No messages in this view' : 'No conversation yet'}
              description={
                missions.length
                  ? 'Switch the filter to see other messages.'
                  : 'Tell KERAI what to accomplish from the Home screen — every request and its result appears here as a conversation.'
              }
            />
          ) : (
            threads.map(mission => <MessagePair key={mission.id} mission={mission} />)
          )}
        </div>
      </section>

      <p className="chat-thread__hint">
        <Icon name="chat" size={13} />
        <span>Each message is a real mission — view it in <button type="button" className="link-button" onClick={() => navigate('/missions')}>Missions</button>.</span>
      </p>
    </div>
  );
}

function MessagePair({ mission }: { mission: Mission }) {
  const status = MISSION_STATUS[mission.status] ?? { label: mission.status, tone: 'neutral' as const };
  const reply = mission.result ?? mission.error ?? status.label;
  const failed = mission.status === 'Failed' || mission.status === 'Cancelled';

  return (
    <div className="chat-pair">
      <div className="chat-bubble chat-bubble--user">
        <div className="chat-bubble__meta">
          <span className="chat-bubble__who">You</span>
          <span className="chat-bubble__time">{formatTime(mission.createdAt)}</span>
        </div>
        <div className="chat-bubble__text">{mission.goal}</div>
      </div>
      <div className="chat-bubble chat-bubble--kerai">
        <div className="chat-bubble__meta">
          <span className="chat-bubble__who">KERAI</span>
          <span className="chat-bubble__time">{formatTime(mission.updatedAt)}</span>
          <span className={`chat-bubble__status chat-bubble__status--${failed ? 'error' : status.tone}`}>{status.label}</span>
        </div>
        <div className={`chat-bubble__text ${failed ? 'chat-bubble__text--error' : ''}`}>{reply}</div>
      </div>
    </div>
  );
}
