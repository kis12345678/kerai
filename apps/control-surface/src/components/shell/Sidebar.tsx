import { Icon } from '../icons';
import { NAV_SECTIONS, ROUTES } from '../../lib/routes';

export interface SidebarProps {
  route: string;
  onNavigate: (path: string) => void;
  /** Local OS user shown in the profile chip (from the gateway). */
  user?: string;
  className?: string;
}

export function Sidebar({ route, onNavigate, user, className }: SidebarProps) {
  return (
    <nav className={`sidebar ${className ?? ''}`.trim()} aria-label="Primary">
      <div className="sidebar__nav">
        {NAV_SECTIONS.map(section => {
          const items = ROUTES.filter(routeDef => routeDef.section === section.id);
          if (items.length === 0) return null;
          return (
            <div key={section.id} className="nav-section">
              <span className="nav-section__label">{section.label}</span>
              {items.map(item => {
                const active = route === item.path || (item.path === '/' && route === '');
                return (
                  <button
                    key={item.path}
                    type="button"
                    className="nav-item"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavigate(item.path)}
                  >
                    <Icon name={item.icon} size={16} />
                    <span>{item.label}</span>
                    {item.key ? (
                      <span className="nav-item__key">
                        <span className="kbd">⌘{item.key.toUpperCase()}</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="sidebar__profile">
        <span className="profile-avatar" aria-hidden="true">{(user ?? 'K').slice(0, 1).toUpperCase()}</span>
        <span className="profile-copy">
          <span className="profile-name">{user ?? 'Local user'}</span>
          <span className="profile-role">Local operator</span>
        </span>
      </div>
    </nav>
  );
}
