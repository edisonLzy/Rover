import { X } from 'lucide-react';
import type { PromptDocumentV1 } from './PromptInput/types.js';

export interface PendingPromptItem {
  id: string;
  doc: PromptDocumentV1;
  textSnippet: string;
  createdAt: number;
}

export interface PendingQueueProps {
  queue: PendingPromptItem[];
  onRemove: (id: string) => void;
  onConfirmNext: () => void;
  onDefer: () => void;
  isDeferred?: boolean;
  canProceed: boolean;
  disabled?: boolean;
}

export function PendingQueue({
  queue,
  onRemove,
  onConfirmNext,
  onDefer,
  isDeferred = false,
  canProceed,
  disabled = false,
}: PendingQueueProps) {
  if (queue.length === 0) return null;
  return (
    <section
      className="prompt-queue mt-[10px] rounded-[19px] border border-[#dce8fa] bg-[#fffffff4] px-[14px] py-3 text-[#374c66] shadow-[0_8px_22px_#1c365326]"
      aria-label="待处理 Prompt"
    >
      <div className="prompt-queue-head flex items-center justify-between gap-2 [&>strong]:text-xs [&>span]:text-[10px] [&>span]:font-extrabold [&>span]:text-[#6080ad]">
        <strong>待处理 Prompt</strong>
        <span>{queue.length} 条</span>
      </div>
      <p className="mt-[5px] mb-2 text-[10px] leading-[1.45] text-[#657993]">
        {!canProceed
          ? '当前输入处理中。下面的 Prompt 暂存在界面，尚未交给 Rover。'
          : isDeferred
            ? '已暂停继续处理。需要时再确认下一条。'
            : '本轮已结束。是否继续处理下一条？'}
      </p>
      <ol className="m-0 grid max-h-[150px] list-none gap-[5px] overflow-y-auto p-0">
        {queue.map((item, idx) => (
          <li
            key={item.id}
            className="flex items-center gap-[7px] rounded-[9px] bg-[#f3f7fd] px-[9px] py-[7px] text-[10px] leading-[1.35]"
          >
            <span title={item.textSnippet} className="min-w-0 flex-1 truncate">
              {idx + 1}. {item.textSnippet}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(item.id)}
              aria-label={`移除待处理 Prompt ${idx + 1}`}
              className="border-0 bg-transparent p-0 text-[#8394aa]"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ol>
      {canProceed && (
        <div className="prompt-queue-actions mt-[9px] flex gap-[7px] [&>button]:rounded-full [&>button]:border-0 [&>button]:px-[10px] [&>button]:py-[7px] [&>button]:text-[10px] [&>button]:font-extrabold">
          <button
            type="button"
            className="queue-continue bg-[#3479ed] text-white hover:bg-[#2266d9]"
            onClick={onConfirmNext}
          >
            继续下一条
          </button>
          <button
            type="button"
            className="bg-[#e9f0fb] text-[#426b9f] hover:bg-[#dce9ff]"
            onClick={onDefer}
          >
            暂不处理
          </button>
        </div>
      )}
    </section>
  );
}
