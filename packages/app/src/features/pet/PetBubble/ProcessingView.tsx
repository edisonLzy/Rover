import React from 'react';
import type { BubbleState } from './types.js';

export interface ProcessingViewProps {
  state: Extract<BubbleState, { status: 'thinking' | 'tool_call' | 'approval' }>;
  resolving?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
}

export function ProcessingView({
  state,
  resolving = false,
  onApprove,
  onDeny,
}: ProcessingViewProps) {
  if (state.status === 'thinking') {
    return (
      <div className="flex items-center gap-[6px] text-xs text-[#3c4d65] select-text">
        <i
          className="speech-spinner size-[10px] shrink-0 rounded-full border-2 border-[#bfd2f4] border-t-[#3d79d8] motion-safe:animate-spin"
          aria-hidden="true"
        />
        <span className="truncate">正在思考中…</span>
      </div>
    );
  }

  if (state.status === 'tool_call') {
    return (
      <div className="flex items-center gap-[6px] text-xs font-mono text-[#3c4d65] select-text">
        <span className="shrink-0 text-amber-500 font-sans" aria-hidden="true">
          ⚡
        </span>
        <span className="truncate">{state.summary}</span>
      </div>
    );
  }

  if (state.status === 'approval') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-[6px] text-xs font-mono text-[#3c4d65] select-text">
          <span className="shrink-0 text-amber-500 font-sans" aria-hidden="true">
            {state.icon}
          </span>
          <span className="truncate" title={state.summary}>
            {state.summary}
          </span>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={resolving}
            className="flex-1 rounded-full border border-transparent bg-[#386bb9] py-1 text-center text-[11px] font-extrabold text-white shadow-sm transition hover:bg-[#2c589a] active:scale-95 disabled:opacity-50 cursor-pointer"
            onClick={onApprove}
            aria-label="允许"
          >
            允许
          </button>
          <button
            type="button"
            disabled={resolving}
            className="flex-1 rounded-full border border-[#cbd5e1] bg-white py-1 text-center text-[11px] font-extrabold text-[#64748b] shadow-sm transition hover:bg-[#f1f5f9] hover:text-[#334155] active:scale-95 disabled:opacity-50 cursor-pointer"
            onClick={onDeny}
            aria-label="拒绝"
          >
            拒绝
          </button>
        </div>
      </div>
    );
  }

  return null;
}
