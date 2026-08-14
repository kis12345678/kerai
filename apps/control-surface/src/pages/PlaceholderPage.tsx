import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon, type IconName } from '../components/icons';

export interface PlaceholderPageProps {
  title: string;
  subtitle: string;
  icon: IconName;
  description: string;
  milestone: string;
}

/** Shared placeholder so every planned page has the same premium empty state. */
export function PlaceholderPage({ title, subtitle, icon, description, milestone }: PlaceholderPageProps) {
  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">{title}</h1>
          <p className="page__subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-4)' }}>
        <EmptyState
          icon={icon}
          title={`${title} arrives in ${milestone}`}
          description={description}
        />
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Badge tone="info">Planned</Badge>
          <Badge>{milestone}</Badge>
        </div>
      </div>
    </div>
  );
}
