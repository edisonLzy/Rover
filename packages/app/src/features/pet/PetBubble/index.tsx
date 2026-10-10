import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { BadgeShelf } from './BadgeShelf.js';
import { ProcessingView } from './ProcessingView.js';
import {
  type BubbleState,
  isProcessing,
  parseApprovalPayload,
  summarizeToolCall,
} from './types.js';
import type { useFollowUps } from '../useFollowUps.js';
import { useRuntime } from '../../../context/RuntimeContext.js';
import { trpc } from '../../../utils/trpc.js';

export interface PetBubbleProps {
  text?: string | null;
  isBusy?: boolean;
  scale?: number;
  followUps?: ReturnType<typeof useFollowUps>;
  isThinking?: boolean;
  isError?: boolean;
  statusLabel?: string;
  onClose?: () => void;
  onOpenSession?: () => void;
  sessionLabel?: string;
  state?: BubbleState;
  resolving?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
}

export function PetBubble(props: PetBubbleProps) {
  if (props.text !== undefined || props.state !== undefined) {
    return <PetBubbleView {...props} />;
  }
  return <AutonomousPetBubble {...props} />;
}

function AutonomousPetBubble(props: Omit<PetBubbleProps, 'text' | 'state'>) {
  const { wsClient } = useRuntime();
  const resolveMutation = trpc.permissions?.resolve?.useMutation?.() ?? {
    mutateAsync: async () => {},
  };
  const pendingRequestsQuery = trpc.permissions?.getPendingRequests?.useQuery?.(undefined, {
    refetchOnWindowFocus: false,
  });

  const [state, setState] = useState<BubbleState>({ status: 'idle' });
  const [resolving, setResolving] = useState(false);

  const activeTurnRef = useRef<string | null>(null);
  const finishedTurnIdsRef = useRef<Set<string>>(new Set());
  const answerRef = useRef('');

  useEffect(() => {
    if (
      state.status === 'idle' &&
      pendingRequestsQuery?.data &&
      pendingRequestsQuery.data.length > 0
    ) {
      const first = pendingRequestsQuery.data[0];
      const parsed = parseApprovalPayload(first.requestId, first.payload);
      setState({
        status: 'approval',
        requestId: first.requestId,
        kind: parsed.kind,
        summary: parsed.summary,
        icon: parsed.icon,
        payload: parsed.payload,
      });
    }
  }, [pendingRequestsQuery?.data, state.status]);

  useEffect(() => {
    return wsClient.registerEventHandler({
      'turn.started': (payload) => {
        if (finishedTurnIdsRef.current.has(payload.turnId)) return;
        activeTurnRef.current = payload.turnId;
        answerRef.current = '';
        setState({ status: 'thinking' });
      },
      'turn.delta': (payload) => {
        if (activeTurnRef.current !== payload.turnId) return;
        const thinking = payload.isThinking === true;
        if (thinking) {
          setState((prev) => (prev.status === 'approval' ? prev : { status: 'thinking' }));
        } else {
          if (typeof payload.accumulated === 'string' && payload.accumulated) {
            answerRef.current = payload.accumulated;
          } else if (typeof payload.textDelta === 'string') {
            answerRef.current += payload.textDelta;
          }
          if (answerRef.current) {
            setState((prev) =>
              prev.status === 'approval' ? prev : { status: 'result', content: answerRef.current }
            );
          }
        }
      },
      'turn.tool_call': (payload) => {
        if (activeTurnRef.current !== payload.turnId) return;
        const summary = summarizeToolCall(payload.toolName, payload.args);
        setState({
          status: 'tool_call',
          toolName: payload.toolName,
          summary,
        });
      },
      'permission.requested': (payload) => {
        const parsed = parseApprovalPayload(payload.requestId, payload.payload);
        setState({
          status: 'approval',
          requestId: payload.requestId,
          kind: parsed.kind,
          summary: parsed.summary,
          icon: parsed.icon,
          payload: parsed.payload,
        });
      },
      'turn.tool_result': (payload) => {
        if (activeTurnRef.current !== payload.turnId) return;
        if (answerRef.current) {
          setState({ status: 'result', content: answerRef.current });
        } else {
          setState({ status: 'thinking' });
        }
      },
      'turn.end': (payload) => {
        finishedTurnIdsRef.current.add(payload.turnId);
        if (finishedTurnIdsRef.current.size > 100) {
          const oldest = finishedTurnIdsRef.current.values().next().value;
          if (oldest) finishedTurnIdsRef.current.delete(oldest);
        }
        if (activeTurnRef.current !== payload.turnId) return;
        activeTurnRef.current = null;
        const failed = payload.status === 'failed' || typeof payload.error === 'string';
        if (failed) {
          setState({
            status: 'result',
            content: typeof payload.error === 'string' ? payload.error : '回合失败',
            isError: true,
          });
        } else {
          setState({
            status: 'result',
            content: answerRef.current || '回复完成',
          });
        }
      },
    });
  }, [wsClient]);

  const handleApprove = async () => {
    if (state.status !== 'approval') return;
    const { requestId, kind } = state;
    setResolving(true);
    try {
      if (kind === 'workspace_access') {
        await resolveMutation.mutateAsync({
          requestId,
          approved: true,
          trustWorkspace: true,
        });
      } else {
        await resolveMutation.mutateAsync({
          requestId,
          approved: true,
        });
      }
      setState({
        status: 'tool_call',
        toolName: (state.payload as any)?.toolName || 'tool',
        summary: state.summary,
      });
    } catch (err) {
      console.error('Failed to resolve permission approval:', err);
    } finally {
      setResolving(false);
    }
  };

  const handleDeny = async () => {
    if (state.status !== 'approval') return;
    const { requestId } = state;
    setResolving(true);
    try {
      await resolveMutation.mutateAsync({
        requestId,
        approved: false,
      });
      setState({ status: 'thinking' });
    } catch (err) {
      console.error('Failed to deny permission approval:', err);
    } finally {
      setResolving(false);
    }
  };

  const handleClose = () => {
    if (state.status === 'approval') {
      void resolveMutation.mutateAsync({
        requestId: state.requestId,
        approved: false,
      });
    }
    setState({ status: 'idle' });
    activeTurnRef.current = null;
    props.onClose?.();
  };

  return (
    <PetBubbleView
      {...props}
      state={state}
      resolving={resolving}
      onApprove={handleApprove}
      onDeny={handleDeny}
      onClose={handleClose}
      onOpenSession={props.onOpenSession}
      sessionLabel={props.sessionLabel}
    />
  );
}

function PetBubbleView({
  text,
  isBusy = false,
  scale = 1,
  followUps,
  isThinking = false,
  isError = false,
  onClose,
  onOpenSession,
  sessionLabel = '打开原会话',
  state,
  resolving = false,
  onApprove,
  onDeny,
}: PetBubbleProps) {
  const closeRef = useRef(onClose);
  const [isHovered, setIsHovered] = useState(false);
  const queueLength = followUps?.items.length ?? 0;
  closeRef.current = onClose;

  const effectiveState: BubbleState = useMemo(() => {
    if (state) return state;
    if (isThinking) return { status: 'thinking' };
    if (text) return { status: 'result', content: text, isError };
    if (isBusy) return { status: 'thinking' };
    return { status: 'idle' };
  }, [state, isThinking, text, isError, isBusy]);

  useEffect(() => {
    if (
      isProcessing(effectiveState) ||
      effectiveState.status === 'idle' ||
      isBusy ||
      queueLength ||
      isHovered ||
      followUps?.error
    ) {
      return;
    }
    const timer = setTimeout(() => closeRef.current?.(), 10000);
    return () => clearTimeout(timer);
  }, [effectiveState, isBusy, queueLength, isHovered, followUps?.error]);

  if (effectiveState.status === 'idle' && !queueLength && !followUps?.error) return null;

  return (
    <div
      className={`pet-speech relative col-start-1 row-start-1 z-8 w-[255px] justify-self-end rounded-[20px] border border-white bg-[#fffffff7] px-[13px] pt-[11px] pb-3 text-left text-[#334259] shadow-[0_12px_32px_#1d34503d] after:absolute after:top-[calc(50%-7px)] after:right-[-7px] after:size-[13px] after:rotate-45 after:border-t after:border-r after:border-white after:bg-[#fffffff7] after:content-[''] ${
        effectiveState.status === 'result' && effectiveState.isError
          ? 'speech-failed'
          : isProcessing(effectiveState)
            ? 'speech-thinking'
            : 'speech-answer'
      }`}
      role="status"
      aria-live={
        effectiveState.status === 'result' && effectiveState.isError ? 'assertive' : 'polite'
      }
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex-1 min-w-0">
          {isProcessing(effectiveState) ? (
            <ProcessingView
              state={effectiveState}
              resolving={resolving}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          ) : effectiveState.status === 'result' ? (
            <p className="m-0 max-h-[130px] overflow-y-auto select-text text-xs leading-[1.45] whitespace-pre-wrap text-[#3c4d65] [overflow-wrap:anywhere]">
              {effectiveState.content}
            </p>
          ) : (
            <p className="m-0 select-text text-xs leading-[1.45] text-[#3c4d65]">
              {isBusy ? '思考中…' : '待办等待接力'}
            </p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            className="speech-close shrink-0 -mt-0.5 -mr-0.5 p-0.5 text-[#8c9aab] hover:text-[#58687a] border-0 bg-transparent cursor-pointer"
            onClick={onClose}
            aria-label="关闭气泡"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {followUps && (
        <BadgeShelf
          scale={scale}
          items={followUps.items}
          highlightedId={followUps.highlightedId}
          disabled={followUps.syncing || !!followUps.startingId}
          canAdvance={followUps.canAdvance}
          onRemove={followUps.remove}
          onReorder={followUps.reorder}
          onAdvance={followUps.advance}
        />
      )}
      {followUps?.error && (
        <div role="alert" className="mt-2 text-[10px] text-[#a45535]">
          {followUps.error}
        </div>
      )}
      {onOpenSession && (
        <button
          type="button"
          className="speech-link mt-[9px] flex items-center gap-[3px] rounded-full border-0 bg-[#eaf1ff] px-[9px] py-[5px] text-[10px] font-extrabold text-[#386bb9] hover:bg-[#dce9ff]"
          onClick={onOpenSession}
        >
          {sessionLabel} <ArrowUpRight size={12} />
        </button>
      )}
    </div>
  );
}
