import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export interface ApprovalDialogProps {
  open: boolean;
  toolName: string;
  description: string;
  risk: string;
  missionLabel?: string;
  onApprove: () => void;
  onDeny: () => void;
  onClose: () => void;
}

/** Approval is always tied to the exact operation; any argument change re-requests. */
export function ApprovalDialog({
  open,
  toolName,
  description,
  risk,
  missionLabel,
  onApprove,
  onDeny,
  onClose,
}: ApprovalDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Approval required"
      footer={
        <>
          <Button variant="ghost" onClick={onDeny}>Deny</Button>
          <Button variant="primary" onClick={onApprove}>Approve</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{toolName}</span>
          <Badge tone="warning">{risk}</Badge>
        </div>
        <p className="muted">{description}</p>
        {missionLabel ? <p className="faint" style={{ fontSize: 'var(--text-sm)' }}>Mission: {missionLabel}</p> : null}
      </div>
    </Modal>
  );
}
