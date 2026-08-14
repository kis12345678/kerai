import type { ReactNode } from 'react';
import type { Tone } from '../../lib/types';

export interface StatusIndicatorProps {
  /** online/offline/warning/info/error map to the visual tone; 'online' & 'offline' are aliases. */
  state: 'online' | 'offline' | 'warning' | 'info' | 'error';
  label: ReactNode;
}

const STATE_TONE: Record<StatusIndicatorProps['state'], Tone> = {
  online: 'success',
  offline: 'error',
  warning: 'warning',
  info: 'info',
  error: 'error',
};

export function StatusIndicator({ state, label }: StatusIndicatorProps) {
  return (
    <span className={`status status--${STATE_TONE[state]}`}>
      <span className="status__dot" />
      {label}
    </span>
  );
}
