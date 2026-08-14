export interface ProgressBarProps {
  /** 0-100. Omit for indeterminate (active operation without a known percentage). */
  value?: number;
  ariaLabel?: string;
}

export function ProgressBar({ value, ariaLabel }: ProgressBarProps) {
  const determinate = value !== undefined;
  return (
    <div
      className={`progress ${determinate ? '' : 'progress--indeterminate'}`}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? value : undefined}
    >
      <div className="progress__fill" style={determinate ? { width: `${Math.max(0, Math.min(100, value))}%` } : undefined} />
    </div>
  );
}
