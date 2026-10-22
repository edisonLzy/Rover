import { LoaderCircle, ShieldCheck, Wrench } from 'lucide-react';
import type { ProcessingState } from './types.js';

interface ProcessingViewProps {
  state: ProcessingState;
  resolving: boolean;
  error?: string | null;
  onApprove: () => void;
  onDeny: () => void;
}

export function ProcessingView({
  state,
  resolving,
  error,
  onApprove,
  onDeny,
}: ProcessingViewProps) {
  if (state.status === 'idle') return null;
  const approval = state.status === 'approval';
  return (
    <div className={`processing-card ${approval ? 'needs-approval' : ''}`} role="status">
      <div className="processing-label">
        {approval ? (
          <ShieldCheck size={16} />
        ) : state.status === 'tool_call' ? (
          <Wrench size={14} />
        ) : (
          <LoaderCircle size={14} className="motion-safe:animate-spin" />
        )}
        <span>
          {approval ? '需要你的允许' : state.status === 'thinking' ? 'Rover 正在思考' : '正在执行'}
        </span>
      </div>
      {state.status !== 'thinking' && <p className="processing-summary">{state.summary}</p>}
      {approval && (
        <div className="approval-actions">
          <button type="button" onClick={onDeny} disabled={resolving} aria-label="拒绝">
            拒绝
          </button>
          <button type="button" onClick={onApprove} disabled={resolving} aria-label="允许">
            {resolving ? '正在处理…' : '允许'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="panel-error">
          {error}
        </p>
      )}
    </div>
  );
}
