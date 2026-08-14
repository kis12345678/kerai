import { useLive } from '../lib/live';
import { formatTime } from '../lib/format';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { Panel } from '../components/ui/Panel';
import { ActivityItem } from '../components/mission/ActivityItem';

export function ActivityPage() {
  const { activity, refresh } = useLive();

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Activity</h1>
          <p className="page__subtitle">The operational audit trail — never hidden chain-of-thought.</p>
        </div>
        <IconButton icon="refresh" label="Refresh activity" onClick={() => void refresh()} />
      </div>

      <Panel>
        {activity.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No activity yet"
            description="Mission lifecycle events will appear here as missions are created and progress."
          />
        ) : (
          <div style={{ padding: 'var(--sp-3) var(--sp-5) var(--sp-4)' }}>
            {activity.map((entry, index) => (
              <ActivityItem
                key={entry.id}
                title={entry.title}
                detail={entry.detail}
                time={formatTime(entry.time)}
                tone={entry.tone}
                toneLabel={entry.toneLabel}
                last={index === activity.length - 1}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
