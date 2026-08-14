import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icons';
import type { Tone } from '../../lib/types';

export type ToastTone = Exclude<Tone, 'neutral' | 'accent' | 'info'>;

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
  icon: IconName;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

const TONE_ICON: Record<ToastTone, IconName> = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, tone, icon: TONE_ICON[tone] }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="toast-region" role="status" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              <span className="toast__dot" />
              <Icon name={t.icon} size={15} />
              <span>{t.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
