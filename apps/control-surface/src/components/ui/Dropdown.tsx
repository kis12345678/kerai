import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';

export interface DropdownItem {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  muted?: boolean;
  divider?: boolean;
}

export interface DropdownProps {
  label: string;
  items: DropdownItem[];
  selected?: string;
  onSelect: (value: string) => void;
  children?: ReactNode;
  align?: 'left' | 'right';
}

export function Dropdown({ label, items, selected, onSelect, children, align = 'left' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="dropdown">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn--secondary btn--sm"
        onClick={() => setOpen(o => !o)}
      >
        {children}
        <Icon name="chevron-down" size={12} />
      </button>
      {open ? (
        <div className="dropdown__menu" role="menu" style={align === 'right' ? { left: 'auto', right: 0 } : undefined}>
          {items.map((item, index) =>
            item.divider ? (
              <div key={`div-${index}`} className="dropdown__divider" />
            ) : (
              <button
                key={item.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected === item.value}
                aria-selected={selected === item.value}
                disabled={item.disabled}
                className={`dropdown__item ${item.muted ? 'dropdown__item--muted' : ''}`}
                onClick={() => {
                  if (item.disabled || item.muted) return;
                  onSelect(item.value);
                  setOpen(false);
                }}
              >
                <span>{item.label}</span>
                {item.hint ? <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>{item.hint}</span> : null}
                {selected === item.value ? <Icon name="check" size={13} /> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
