import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';

export interface PetBubbleProps {
  text: string | null;
  isThinking?: boolean;
  isError?: boolean;
  statusLabel?: string;
  onClose?: () => void;
  onOpenSession?: () => void;
  sessionLabel?: string;
}

export function PetBubble({
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
