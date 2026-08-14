import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="overlay" style={{ alignItems: 'stretch', justifyContent: 'flex-end', padding: 0 }} onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="drawer" role="dialog" aria-modal="true">
          <div className="drawer__header">
            <h3 style={{ fontSize: 'var(--text-lg)' }}>{title}</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="drawer__body">{children}</div>
        </div>
      </div>
    </>,
    document.body,
  );
}
