import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

export function Input({ label, hint, id, className = '', ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`field ${className}`}>
      {label ? <label className="field__label" htmlFor={inputId}>{label}</label> : null}
      <input id={inputId} className="input" {...rest} />
      {hint ? <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>{hint}</span> : null}
    </div>
  );
}
