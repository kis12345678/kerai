import { useEffect, useState, type ComponentType } from 'react';
import { api } from '../../lib/api';
import { useHashRoute } from '../../lib/router';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { ShortcutsModal } from '../ui/ShortcutsModal';
import { HomePage } from '../../pages/HomePage';
import { ChatPage } from '../../pages/ChatPage';
import { MissionsPage } from '../../pages/MissionsPage';
import { ActivityPage } from '../../pages/ActivityPage';
import { ModelsPage } from '../../pages/ModelsPage';
import { WorkspacePage } from '../../pages/WorkspacePage';
import { MemoryPage } from '../../pages/MemoryPage';
import { SystemPage } from '../../pages/SystemPage';
import { AutomationsPage } from '../../pages/AutomationsPage';
import { SettingsPage } from '../../pages/SettingsPage';
import { AgentsPage } from '../../pages/AgentsPage';

const PAGES: Record<string, ComponentType<{ focusSignal?: number }>> = {
  '/': HomePage,
  '/chat': ChatPage,
  '/missions': MissionsPage,
  '/activity': ActivityPage,
  '/workspace': WorkspacePage,
  '/memory': MemoryPage,
  '/models': ModelsPage,
  '/system': SystemPage,
  '/automations': AutomationsPage,
  '/settings': SettingsPage,
  '/agents/computer': AgentsPage,
  '/agents/coder': AgentsPage,
  '/agents/browser': AgentsPage,
};

const HEALTH_POLL_MS = 10_000;

export function AppShell() {
  const [route, go] = useHashRoute();
  const [coreOnline, setCoreOnline] = useState<boolean | null>(null);
  const [user, setUser] = useState<string | undefined>(undefined);
  const [focusSignal, setFocusSignal] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  /* Core reachability — polled modestly; never assumed. Also surfaces the OS user. */
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await api.health();
        if (!cancelled) {
          setCoreOnline(true);
          if (health.user) setUser(health.user);
        }
      } catch {
        if (!cancelled) setCoreOnline(false);
      }
    };
    void check();
    const timer = window.setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  /* Keyboard shortcuts: ⌘K command center, ⌘J missions, ⌘M memory, / focus prompt, ? shortcuts */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Don't trigger single-key shortcuts when typing in inputs/textareas
      const target = event.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (!isInput && event.key === '/') {
        event.preventDefault();
        go('/');
        setFocusSignal(n => n + 1);
        return;
      }

      if (!isInput && event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(prev => !prev);
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      switch (event.key.toLowerCase()) {
        case 'k':
          event.preventDefault();
          go('/');
          setFocusSignal(n => n + 1);
          break;
        case 'j':
          event.preventDefault();
          go('/missions');
          break;
        case 'm':
          event.preventDefault();
          go('/memory');
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go]);

  const handleNavigate = (path: string) => {
    go(path);
    setMobileNavOpen(false);
  };

  const Page = PAGES[route] ?? HomePage;

  return (
    <div className="shell">
      <TopBar
        coreOnline={coreOnline}
        onHome={() => handleNavigate('/')}
        onSettings={() => handleNavigate('/settings')}
        onToggleShortcuts={() => setShortcutsOpen(true)}
        onToggleMobileNav={() => setMobileNavOpen(prev => !prev)}
      />
      <div className="shell__body">
        <Sidebar route={route} onNavigate={handleNavigate} user={user} className={mobileNavOpen ? 'sidebar--mobile-open' : undefined} />
        <main className="shell__content">
          <Page focusSignal={focusSignal} />
        </main>
      </div>
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
