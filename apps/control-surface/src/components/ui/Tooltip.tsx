import { useRef, useState, type ReactNode } from 'react';

export interface TooltipProps {
  label: string;
  children: ReactNode;
  position?: 'above' | 'below';
}

export function Tooltip({ label, children, position = 'above' }: TooltipProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const el = hostRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor(
      position === 'above'
        ? { left: rect.left + rect.width / 2, top: rect.top - 6 }
        : { left: rect.left + rect.width / 2, top: rect.bottom + 6 },
    );
  };

  const hide = () => setAnchor(null);

  return (
    <span
      ref={hostRef}
      style={{ display: 'inline-flex' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor ? (
        <span
          className={`tooltip tooltip--${position}`}
          role="tooltip"
          style={{ left: anchor.left, top: anchor.top, transform: 'translateX(-50%)' }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
