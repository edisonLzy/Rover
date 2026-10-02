import { Archive, Sparkles, Code, Clock, ArrowDownRight } from 'lucide-react';

interface CompactionItemProps {
  entry: {
    seq: number;
    id: string;
    createdAt: number;
    data: any;
  };
  onInspect: () => void;
}

export function CompactionItem({ entry, onInspect }: CompactionItemProps) {
  const data = entry.data || {};
  const summary = data.summary || '（无压缩摘要）';
  const coveredThroughSeq = data.coveredThroughSeq;
  const tokensBefore = data.tokensBefore;
  const tokensAfter = data.tokensAfter;
  const previousCompactionId = data.previousCompactionId;

  const timeFormatted = new Date(entry.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const percentSaved =
    tokensBefore && tokensAfter && tokensBefore > tokensAfter
      ? Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100)
      : null;

  return (
    <div className="group relative rounded-xl border border-amber-600/40 bg-gradient-to-br from-amber-950/20 via-zinc-900/60 to-zinc-950 p-4 shadow-sm hover:border-amber-500/60 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-amber-900/30">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-6 h-6 rounded-lg bg-amber-950 border border-amber-600/60 flex items-center justify-center text-amber-400 text-xs font-medium">
            <Archive className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            记忆压缩 (Context Compaction)
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/60">
            #{entry.seq}
          </span>
          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300">
            覆盖边界: Seq #{coveredThroughSeq}
          </span>
          {tokensBefore !== undefined && tokensAfter !== undefined && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
              <ArrowDownRight className="w-3 h-3 text-emerald-400" />
              {tokensBefore} → {tokensAfter} tok
              {percentSaved !== null && ` (-${percentSaved}%)`}
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

      {/* Summary Body */}
      <div className="pl-8 select-text space-y-2">
        <div className="rounded-lg bg-zinc-950/60 border border-amber-900/20 p-3.5">
          <div className="text-[11px] font-semibold text-amber-400/90 mb-1.5 flex items-center gap-1">
            <span>前序上下文累计摘要</span>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{summary}</p>
        </div>

        {previousCompactionId && (
          <div className="text-[10px] font-mono text-zinc-500 pt-1">
            关联前序快照 ID: {previousCompactionId}
          </div>
        )}
      </div>
    </div>
  );
}
