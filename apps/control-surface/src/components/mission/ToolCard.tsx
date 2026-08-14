import { Badge } from '../ui/Badge';
import type { PermissionLevel, ToolContract } from '../../lib/types';

const RISK_TONE: Record<PermissionLevel, 'success' | 'info' | 'warning' | 'error' | 'error'> = {
  Read: 'success',
  Safe: 'info',
  Modify: 'warning',
  System: 'error',
  Critical: 'error',
};

export function ToolCard({ tool }: { tool: ToolContract }) {
  return (
    <article className="tool-card">
      <div className="tool-card__name">{tool.name}</div>
      <div className="tool-card__desc">{tool.description}</div>
      <div className="tool-card__meta">
        <Badge tone={RISK_TONE[tool.risk]}>{tool.risk}</Badge>
        {tool.requiresApproval ? <Badge tone="warning">approval</Badge> : <Badge>auto</Badge>}
        <Badge>{tool.timeout}</Badge>
      </div>
    </article>
  );
}
