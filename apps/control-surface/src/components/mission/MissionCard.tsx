import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';
import { MISSION_STATUS, TERMINAL_STATUSES, formatDateTime, formatTime } from '../../lib/format';
import { buildChecklist, type ActivityEntry } from '../../lib/activity';
import type { Mission } from '../../lib/types';

export interface MissionCardProps {
  mission: Mission;
  /** Live activity feed — used to render the mission's step checklist. */
  activity?: ActivityEntry[];
  onCancel?: (mission: Mission) => void;
  cancelling?: boolean;
}

export function MissionCard({ mission, activity = [], onCancel, cancelling = false }: MissionCardProps) {
  const status = MISSION_STATUS[mission.status] ?? { label: mission.status, tone: 'neutral' as const };
  const active = !TERMINAL_STATUSES.includes(mission.status) && mission.status !== 'Created';
  const showProgress = mission.status === 'Running' || mission.status === 'Verifying';
  const steps = buildChecklist(mission.id, mission.status, activity);

  return (
    <article className="mission-card">
      <div className="mission-card__top">
        <div style={{ minWidth: 0 }}>
          <div className="mission-card__goal">{mission.goal}</div>
          <div className="mission-card__meta">
            <span>{formatTime(mission.createdAt)}</span>
            {mission.workspacePath ? <span className="mono">{mission.workspacePath}</span> : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          {mission.lane && mission.lane !== 'Master' ? <Badge tone="info">{mission.lane}</Badge> : null}
          {mission.parentMissionId ? <Badge tone="accent" title={`Dispatched by ${mission.parentMissionId}`}>↳ sub-mission</Badge> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>
      {showProgress ? <ProgressBar ariaLabel={`Mission ${mission.status.toLowerCase()}`} /> : null}
      {steps.length > 1 ? (
        <ol className="mission-checklist">
          {steps.map(step => (
            <li key={step.key} className={`checklist-step checklist-step--${step.state}`}>
              <span className="checklist-step__mark" aria-hidden="true">
                {step.state === 'done' ? '✓' : step.state === 'error' ? '✕' : '●'}
              </span>
              <span className="checklist-step__label">{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {mission.result ? <div className="mission-card__result">{mission.result}</div> : null}
      {mission.error ? <div className="mission-card__result mission-card__result--error">{mission.error}</div> : null}
      {active && onCancel ? (
        <div className="mission-card__actions">
          <Button variant="danger" size="sm" onClick={() => onCancel(mission)} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Stop mission'}
          </Button>
        </div>
      ) : null}
      <div className="mission-card__meta">
        <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{mission.id.slice(0, 8)}</span>
        <span>Updated {formatDateTime(mission.updatedAt)}</span>
      </div>
    </article>
  );
}
