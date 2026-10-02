import { Wrench, CheckCircle2, AlertCircle, Code, Clock } from 'lucide-react';

interface ToolResultItemProps {
  entry: {
    seq: number;
    id: string;
    turnId: string | null;
    createdAt: number;
    data: any;
  };
  onInspect: () => void;
}

export function ToolResultItem({ entry, onInspect }: ToolResultItemProps) {
  const data = entry.data || {};
  const isError = Boolean(data.isError);
  const toolCallId = data.toolCallId || data.toolName || 'unknown';
  const content = data.content;

  const timeFormatted = new Date(entry.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const renderContent = () => {
    if (typeof content === 'string') {
      return (
        <pre className="p-2.5 rounded-lg bg-zinc-950 font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {content}
        </pre>
      );
    }

    if (Array.isArray(content)) {
      return (
        <div className="space-y-1.5">
          {content.map((item: any, idx: number) => {
            if (item?.type === 'text') {
              return (
                <pre
                  key={idx}
                  className="p-2.5 rounded-lg bg-zinc-950 font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed"
                >
                  {item.text}
                </pre>
              );
            }
            return (
              <pre
                key={idx}
                className="p-2.5 rounded-lg bg-zinc-950 font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed"
              >
                {JSON.stringify(item, null, 2)}
              </pre>
            );
          })}
        </div>
      );
    }

    return (
      <pre className="p-2.5 rounded-lg bg-zinc-950 font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
        {JSON.stringify(content, null, 2)}
      </pre>
    );
  };

  return (
    <div
      className={`group relative rounded-xl border p-4 shadow-sm transition-all ${
        isError
          ? 'border-rose-900/60 bg-rose-950/20 hover:border-rose-700/60'
          : 'border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700/80'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-medium border ${
              isError
                ? 'bg-rose-950 border-rose-800 text-rose-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-zinc-200">工具返回 (Tool Result)</span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
            #{entry.seq}
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-400">
            call:{toolCallId}
          </span>
          {isError ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
              <AlertCircle className="w-3 h-3" />
              执行异常
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
              <CheckCircle2 className="w-3 h-3" />
              执行成功
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

      <div className="pl-8 select-text">{renderContent()}</div>
    </div>
  );
}
