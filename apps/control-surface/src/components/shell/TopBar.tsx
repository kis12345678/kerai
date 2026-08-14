import { IconButton } from '../ui/IconButton';
import { StatusIndicator } from '../ui/StatusIndicator';

export interface TopBarProps {
  coreOnline: boolean | null;
  onHome: () => void;
  onSettings: () => void;
  onToggleShortcuts: () => void;
  onToggleMobileNav?: () => void;
}

export function TopBar({ coreOnline, onHome, onSettings, onToggleShortcuts, onToggleMobileNav }: TopBarProps) {
  const state: 'online' | 'offline' | 'warning' = coreOnline === null ? 'warning' : coreOnline ? 'online' : 'offline';
  const label = coreOnline === null ? 'CONNECTING' : coreOnline ? 'CORE ONLINE' : 'CORE OFFLINE';

  return (
    <header className="topbar">
      <div className="topbar__left">
        {onToggleMobileNav ? (
          <button type="button" className="icon-btn topbar__mobile-btn" aria-label="Toggle Navigation" onClick={onToggleMobileNav}>
            <span className="icon" style={{ fontSize: '18px' }}>☰</span>
          </button>
        ) : null}
        <div className="topbar__brand" onClick={onHome} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onHome()}>
          <span className="brand-mark">K</span>
          <span className="topbar__brand-copy">
            <span className="topbar__brand-name">KERAI</span>
            <span className="topbar__tagline">YOUR AI ASSISTANT</span>
          </span>
        </div>
      </div>
      <div className="topbar__right">
        <StatusIndicator state={state} label={label} />
        <IconButton icon="terminal" label="Keyboard Shortcuts" tooltip="Keyboard Shortcuts (?)" onClick={onToggleShortcuts} />
        <IconButton icon="settings" label="Settings" tooltip="Settings" onClick={onSettings} />
      </div>
    </header>
  );
}
