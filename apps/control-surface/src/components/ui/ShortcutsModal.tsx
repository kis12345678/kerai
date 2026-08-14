import { Modal } from './Modal';
import { Icon } from '../icons';

export interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['/'], description: 'Focus Command Input' },
  { keys: ['⌘', 'K'], description: 'Command Center (Home)' },
  { keys: ['⌘', 'J'], description: 'Open Missions' },
  { keys: ['⌘', 'M'], description: 'Open Memory' },
  { keys: ['?'], description: 'Toggle Keyboard Shortcuts' },
  { keys: ['Esc'], description: 'Close Modals / Dismiss' },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}><Icon name="terminal" size={18} /> Keyboard Shortcuts</span>} width={480}>
      <div className="shortcuts-list" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-2) 0' }}>
        {SHORTCUTS.map((s, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-2) var(--sp-3)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{s.description}</span>
            <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
              {s.keys.map((k, kIdx) => (
                <kbd key={kIdx} style={{ background: 'var(--inset)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', padding: '2px 6px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }}>
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
