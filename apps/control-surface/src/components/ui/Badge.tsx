import type { ReactNode } from 'react';
import type { Tone } from '../../lib/types';

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = 'neutral', children, title }: BadgeProps) {
  return (
    <span className={`badge ${tone !== 'neutral' ? `badge--${tone}` : ''}`} title={title}>
      {children}
    </span>
  );
}
