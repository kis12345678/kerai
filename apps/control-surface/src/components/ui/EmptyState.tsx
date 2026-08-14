import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = 'command', title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={18} />
      </div>
      <div className="empty__title">{title}</div>
      {description ? <div className="empty__desc">{description}</div> : null}
      {action ? <div style={{ marginTop: 'var(--sp-2)' }}>{action}</div> : null}
    </div>
  );
}
