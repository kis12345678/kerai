import type { ReactNode } from 'react';

export interface SystemMetricProps {
  label: string;
  value: ReactNode;
  status?: ReactNode;
}

export function SystemMetric({ label, value, status }: SystemMetricProps) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value">{value}</div>
      {status ? <div className="metric__status">{status}</div> : null}
    </div>
  );
}
