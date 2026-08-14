import { useRef, type KeyboardEvent, type Ref } from 'react';
import { Icon } from '../icons';
import { Tooltip } from './Tooltip';

export interface CommandInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  hint?: React.ReactNode;
  /** Optional slot for the mic button (voice arrives in a later milestone). */
  trailing?: React.ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
}

export function CommandInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'What do you want KERAI to accomplish?',
  busy = false,
  disabled = false,
  autoFocus = false,
  hint,
  trailing,
  inputRef,
}: CommandInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && !busy && !disabled) onSubmit(trimmed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') {
      onChange('');
      event.preventDefault();
    }
  };

  return (
    <div>
      <div className="command-input">
        <textarea
          ref={inputRef ?? textareaRef}
          value={value}
          onChange={event => {
            onChange(event.target.value);
            autosize();
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-label={placeholder}
          rows={1}
        />
        {trailing}
        <Tooltip label={busy ? 'Working…' : 'Submit command (Enter)'} position="above">
          <button
            type="button"
            className="btn btn--primary command-input__submit"
            onClick={submit}
            disabled={busy || disabled || !value.trim()}
            aria-label="Submit command"
          >
            {busy ? <Icon name="stop" size={14} /> : <Icon name="arrow-up" size={16} />}
          </button>
        </Tooltip>
      </div>
      {hint ? <div className="command-input__hint">{hint}</div> : null}
    </div>
  );
}
