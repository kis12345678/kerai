import type { IconName } from '../components/icons';

export interface RouteDef {
  path: string;
  label: string;
  icon: IconName;
  /** Keyboard shortcut letter (used with Ctrl/Cmd). Empty = no shortcut. */
  key: string;
  section: 'core' | 'system' | 'agents' | 'settings';
}

export const ROUTES: RouteDef[] = [
  /* CORE — the AI experience: presence, conversation, missions, activity. */
  { path: '/', label: 'Home', icon: 'command', key: 'k', section: 'core' },
  { path: '/chat', label: 'Chat', icon: 'chat', key: '', section: 'core' },
  { path: '/missions', label: 'Missions', icon: 'mission', key: 'j', section: 'core' },
  { path: '/activity', label: 'Activity', icon: 'activity', key: '', section: 'core' },

  /* SYSTEM — the underlying infrastructure KERAI operates. */
  { path: '/workspace', label: 'Workspace', icon: 'workspace', key: '', section: 'system' },
  { path: '/memory', label: 'Memory', icon: 'memory', key: 'm', section: 'system' },
  { path: '/models', label: 'Models', icon: 'models', key: '', section: 'system' },
  { path: '/system', label: 'System', icon: 'system', key: '', section: 'system' },
  { path: '/automations', label: 'Automations', icon: 'automations', key: '', section: 'system' },

  /* AGENTS — specialist lanes dispatched by the Master. */
  { path: '/agents/computer', label: 'Computer', icon: 'cpu', key: '', section: 'agents' },
  { path: '/agents/coder', label: 'Coder', icon: 'code', key: '', section: 'agents' },
  { path: '/agents/browser', label: 'Browser', icon: 'globe', key: '', section: 'agents' },

  /* SETTINGS. */
  { path: '/settings', label: 'Settings', icon: 'settings', key: '', section: 'settings' },
];

export const NAV_SECTIONS: { id: RouteDef['section']; label: string }[] = [
  { id: 'core', label: 'CORE' },
  { id: 'system', label: 'SYSTEM' },
  { id: 'agents', label: 'AGENTS' },
  { id: 'settings', label: 'SETTINGS' },
];
