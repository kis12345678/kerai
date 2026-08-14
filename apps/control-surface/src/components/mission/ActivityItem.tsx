import type { ReactNode } from 'react';
import type { Tone } from '../../lib/types';

export interface ActivityItemProps {
  /** Event type, e.g. "Mission created". */
  title: ReactNode;
  /** What the event was about, e.g. the mission goal. */
  detail?: ReactNode;
  time: string;
  tone?: Exclude<Tone, 'neutral'>;
  /** Short event-class label, e.g. INFO / SUCCESS / WARNING / ERROR. */
  toneLabel?: string;
  meta?: ReactNode;
  last?: boolean;
}

export function ActivityItem({ title, detail, time, tone = 'info', toneLabel, meta, last = false }: ActivityItemProps) {
  return (
    <div className="activity">
      <div className="activity__rail">
        <span className={`activity__dot activity__dot--${tone}`} />
        {last ? null : <span className="activity__line" />}
      </div>
      <div className="activity__body">
        <div className="activity__title">{title}</div>
        {detail ? <div className="activity__detail">{detail}</div> : null}
        <div className="activity__meta">
          <span className="mono">{time}</span>
          {toneLabel ? <span className={`activity__tone-label activity__tone-label--${tone}`}>{toneLabel}</span> : null}
          {meta ? <span>{meta}</span> : null}
        </div>
      </div>
    </div>
  );
}
