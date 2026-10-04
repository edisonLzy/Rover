import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { useRuntime } from '../../../context/RuntimeContext.js';

export interface PetBubbleProps {
  text?: string | null;
  isThinking?: boolean;
  isError?: boolean;
  statusLabel?: string;
  onClose?: () => void;
  onOpenSession?: () => void;
  sessionLabel?: string;
}

export function PetBubble(props: PetBubbleProps) {
  if (props.text !== undefined) {
    return <PetBubbleView {...props} />;
  }
  return <AutonomousPetBubble {...props} />;
}

function AutonomousPetBubble(props: Omit<PetBubbleProps, 'text'>) {
  const { wsClient } = useRuntime();
  const [text, setText] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isError, setIsError] = useState(false);

  const activeTurnRef = useRef<string | null>(null);
  const finishedTurnIdsRef = useRef<Set<string>>(new Set());
  const answerRef = useRef('');
  const thinkingRef = useRef(false);

  useEffect(() => {
    return wsClient.registerEventHandler({
      'turn.started': (payload) => {
        if (finishedTurnIdsRef.current.has(payload.turnId)) return;
        activeTurnRef.current = payload.turnId;
        answerRef.current = '';
        thinkingRef.current = false;
        setText('思考中…');
        setIsThinking(true);
        setIsError(false);
      },
      'turn.delta': (payload) => {
        if (activeTurnRef.current !== payload.turnId) return;
        const thinking = payload.isThinking === true;
        if (thinkingRef.current !== thinking) {
          answerRef.current = '';
        }
        thinkingRef.current = thinking;
        if (typeof payload.accumulated === 'string' && payload.accumulated) {
          answerRef.current = payload.accumulated;
        } else {
          const delta = thinking ? payload.thinkingDelta : payload.textDelta;
          if (typeof delta === 'string') {
            answerRef.current += delta;
          }
        }
        setIsThinking(thinking);
        setIsError(false);
        setText(answerRef.current || (thinking ? '深度思考中…' : ''));
      },
      'turn.end': (payload) => {
        finishedTurnIdsRef.current.add(payload.turnId);
        if (finishedTurnIdsRef.current.size > 100) {
          const oldest = finishedTurnIdsRef.current.values().next().value;
          if (oldest) finishedTurnIdsRef.current.delete(oldest);
        }
        if (activeTurnRef.current !== payload.turnId) return;
        activeTurnRef.current = null;
        setIsThinking(false);
        const failed = payload.status === 'failed' || typeof payload.error === 'string';
        setIsError(failed);
        if (failed) {
          setText(typeof payload.error === 'string' ? payload.error : '回合失败');
        } else if (!answerRef.current) {
          setText('回复完成');
        }
      },
    });
  }, [wsClient]);

  const handleClose = () => {
    setText(null);
    activeTurnRef.current = null;
    props.onClose?.();
  };

  return (
    <PetBubbleView
      text={text}
      isThinking={isThinking}
      isError={isError}
      statusLabel={props.statusLabel}
      onClose={handleClose}
      onOpenSession={props.onOpenSession}
      sessionLabel={props.sessionLabel}
    />
  );
}

function PetBubbleView({
  text,
  isThinking = false,
  isError = false,
  statusLabel,
  onClose,
  onOpenSession,
  sessionLabel = '打开原会话',
}: PetBubbleProps) {
  const closeRef = useRef(onClose);
  const isHovered = useRef(false);
  closeRef.current = onClose;

  useEffect(() => {
    if (!text || isThinking) return;
    let timer: ReturnType<typeof setTimeout>;
    const dismiss = () => {
      if (isHovered.current) timer = setTimeout(dismiss, 1000);
      else closeRef.current?.();
    };
    timer = setTimeout(dismiss, 10000);
    return () => clearTimeout(timer);
  }, [text, isThinking]);

  if (!text) return null;

  return (
    <div
      className={`pet-speech absolute top-1/2 right-[calc(50%+55px)] z-8 w-[255px] -translate-y-1/2 rounded-[20px] border border-white bg-[#fffffff7] px-[13px] pt-[11px] pb-3 text-left text-[#334259] shadow-[0_12px_32px_#1d34503d] after:absolute after:top-[calc(50%-7px)] after:right-[-7px] after:size-[13px] after:rotate-45 after:border-t after:border-r after:border-white after:bg-[#fffffff7] after:content-[''] ${isError ? 'speech-failed' : isThinking ? 'speech-thinking' : 'speech-answer'}`}
      role="status"
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={() => {
        isHovered.current = true;
      }}
      onMouseLeave={() => {
        isHovered.current = false;
      }}
    >
      <div className="speech-head mb-[5px] flex items-center justify-between gap-2">
        <span className="speech-status flex items-center gap-[6px] text-[10px] font-extrabold text-[#5876a4]">
          <i
            className={
              isThinking
                ? 'speech-spinner size-[10px] rounded-full border-2 border-[#bfd2f4] border-t-[#3d79d8] motion-safe:animate-spin'
                : `speech-dot size-[7px] rounded-full ${isError ? 'bg-[#d78b4a]' : 'bg-[#40a977]'}`
            }
            aria-hidden="true"
          />
          {statusLabel || (isThinking ? '正在判断' : isError ? '暂时无法处理' : 'Rover 回答')}
        </span>
        {onClose && (
          <button
            type="button"
            className="speech-close border-0 bg-transparent px-[2px] py-0 text-[#8c9aab]"
            onClick={onClose}
            aria-label="关闭气泡"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <p className="m-0 max-h-[130px] overflow-y-auto select-text text-xs leading-[1.45] whitespace-pre-wrap text-[#3c4d65] [overflow-wrap:anywhere]">
        {text}
      </p>
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
