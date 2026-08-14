import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'sm' | 'md';
  tooltip?: string;
}

export function IconButton({ icon, label, size = 'md', tooltip, className = '', ...rest }: IconButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={label}
      className={`icon-btn ${size === 'sm' ? 'icon-btn--sm' : ''} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
  return tooltip ? <Tooltip label={tooltip}>{button}</Tooltip> : button;
}
