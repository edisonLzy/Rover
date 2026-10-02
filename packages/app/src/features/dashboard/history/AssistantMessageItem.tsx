import { useState } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Wrench,
  Code,
  Clock,
  Zap,
  AlertTriangle,
} from 'lucide-react';

interface AssistantMessageItemProps {
  entry: {
    seq: number;
    id: string;
    turnId: string | null;
    createdAt: number;
    data: any;
  };
  onInspect: () => void;
}

export function AssistantMessageItem({ entry, onInspect }: AssistantMessageItemProps) {
  const data = entry.data || {};
  const rawContent = data.content;

  // Normalize blocks
  const blocks: any[] = Array.isArray(rawContent)
    ? rawContent
    : typeof rawContent === 'string'
      ? [{ type: 'text', text: rawContent }]
      : [];

  const thinkingBlocks = blocks.filter((b) => b?.type === 'thinking');
  const toolCallBlocks = blocks.filter((b) => b?.type === 'toolCall');
  const textBlocks = blocks.filter((b) => b?.type === 'text');

  // Collapse thinking if final text exists, matching divisor-agent behavior
  const [isThinkingOpen, setIsThinkingOpen] = useState(textBlocks.length === 0);

  const stopReason = data.stopReason;
  const usage = data.usage;
  const errorMessage = data.errorMessage;

  const timeFormatted = new Date(entry.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="group relative rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 shadow-sm hover:border-zinc-700/80 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-6 h-6 rounded-lg bg-emerald-950 border border-emerald-800/80 flex items-center justify-center text-emerald-400 text-xs font-medium">
            🐕
          </div>
          <span className="text-xs font-semibold text-zinc-200">Rover 助手 (Assistant)</span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
            #{entry.seq}
          </span>
          {entry.turnId && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-500">
              turn:{entry.turnId.slice(0, 8)}
            </span>
          )}
          {stopReason && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                stopReason === 'error'
                  ? 'bg-rose-950 text-rose-300 border border-rose-800/60'
                  : stopReason === 'aborted'
                    ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                    : stopReason === 'toolUse'
                      ? 'bg-blue-950 text-blue-300 border border-blue-800/60'
                      : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {stopReason}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-zinc-500 font-mono">
            <Clock className="w-3 h-3" />
            {timeFormatted}
          </span>
          <button
            onClick={onInspect}
            title="查看原始 JSON"
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 opacity-60 group-hover:opacity-100 transition-all cursor-pointer"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="pl-8 space-y-3 select-text">
        {/* Error message banner if any */}
        {errorMessage && (
          <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-2.5 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">错误中断：</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Thinking Collapsible (Divisor-agent style) */}
        {thinkingBlocks.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
            <button
              onClick={() => setIsThinkingOpen(!isThinkingOpen)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-indigo-400" />
                <span>思考过程 (Thinking)</span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  ({thinkingBlocks.reduce((acc, t) => acc + (t.thinking?.length || 0), 0)} 字符)
                </span>
              </div>
              {isThinkingOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              )}
            </button>

            {isThinkingOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-zinc-800/80 text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                {thinkingBlocks.map((t, idx) => (
                  <p key={idx} className="italic text-zinc-400">
                    {t.thinking}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tool Call Cards */}
        {toolCallBlocks.length > 0 && (
          <div className="space-y-2">
            {toolCallBlocks.map((call, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-2.5 text-xs text-zinc-200"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-blue-400" />
                    <span className="font-semibold text-blue-300 font-mono">{call.name}</span>
                    <span className="font-mono text-[10px] text-zinc-500">id:{call.id}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800">
                    受控工具调用
                  </span>
                </div>
                {call.arguments && (
                  <pre className="p-2 rounded bg-zinc-950/80 font-mono text-[11px] text-zinc-300 overflow-x-auto">
                    {typeof call.arguments === 'string'
                      ? call.arguments
                      : JSON.stringify(call.arguments, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Assistant Answer Text */}
        {textBlocks.length > 0 ? (
          <div className="space-y-2 text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
            {textBlocks.map((t, idx) => (
              <p key={idx}>{t.text}</p>
            ))}
          </div>
        ) : (
          toolCallBlocks.length === 0 &&
          thinkingBlocks.length === 0 && (
            <p className="text-xs text-zinc-500 italic">（无文本输出）</p>
          )
        )}

        {/* Usage / Cost Badges */}
        {usage && (
          <div className="flex items-center gap-3 pt-2 text-[10px] font-mono text-zinc-500 border-t border-zinc-800/40">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" />
              <span>
                Token: {usage.input ?? 0} in / {usage.output ?? 0} out
              </span>
            </span>
            {usage.cacheRead !== undefined && usage.cacheRead > 0 && (
              <span>缓存命中: {usage.cacheRead}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
