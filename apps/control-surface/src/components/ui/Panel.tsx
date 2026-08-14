import type { ReactNode } from 'react';

export interface PanelProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}

/** Card = Panel with a header; use either name for the same surface. */
export function Panel({ title, eyebrow, actions, footer, children, flush = false, className = '' }: PanelProps) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section className={`panel ${className}`}>
      {hasHeader ? (
        <div className="panel__header">
          <div>
            {eyebrow ? <span className="eyebrow" style={{ display: 'block', marginBottom: 'var(--sp-1)' }}>{eyebrow}</span> : null}
            {title ? <h2 className="panel__title">{title}</h2> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}
      <div className={`panel__body ${flush ? 'panel__body--flush' : ''}`}>{children}</div>
      {footer ? <div className="panel__foot">{footer}</div> : null}
    </section>
  );
}

export const Card = Panel;
