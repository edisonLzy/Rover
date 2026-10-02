import { Code, Clock } from 'lucide-react';

interface UserMessageItemProps {
  entry: {
    seq: number;
    id: string;
    turnId: string | null;
    createdAt: number;
    data: any;
  };
  onInspect: () => void;
}

export function UserMessageItem({ entry, onInspect }: UserMessageItemProps) {
  const content = entry.data?.content;
  const timeFormatted = new Date(entry.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const renderContent = () => {
    if (typeof content === 'string') {
      return (
        <p className="whitespace-pre-wrap break-words text-sm text-zinc-200 leading-relaxed">
          {content}
        </p>
      );
    }

    if (Array.isArray(content)) {
      return (
        <div className="space-y-1.5 text-sm text-zinc-200">
          {content.map((part: any, idx: number) => {
            if (part?.type === 'text') {
              return (
                <span key={idx} className="whitespace-pre-wrap break-words leading-relaxed">
                  {part.text}
                </span>
              );
            }
            if (part?.type === 'agent') {
              return (
                <span
                  key={idx}
                  className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-blue-950/70 border border-blue-800 text-blue-300 text-xs font-mono"
                >
                  @{part.agentId}
                </span>
              );
            }
            if (part?.type === 'skill') {
              return (
                <span
                  key={idx}
                  className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-purple-950/70 border border-purple-800 text-purple-300 text-xs font-mono"
                >
                  /{part.skillId}
                </span>
              );
            }
            return (
              <span key={idx} className="text-zinc-400">
                {JSON.stringify(part)}
              </span>
            );
          })}
        </div>
      );
    }

    return (
      <p className="whitespace-pre-wrap break-words text-sm text-zinc-300 font-mono">
        {JSON.stringify(content)}
      </p>
    );
  };

  return (
    <div className="group relative rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 shadow-sm hover:border-zinc-700/80 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-6 h-6 rounded-lg bg-cyan-950 border border-cyan-800/80 flex items-center justify-center text-cyan-400 text-xs font-medium">
            👤
          </div>
          <span className="text-xs font-semibold text-zinc-200">用户 (User)</span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
            #{entry.seq}
          </span>
          {entry.turnId && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-500">
              turn:{entry.turnId.slice(0, 8)}
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

      {/* Message Body */}
      <div className="pl-8 select-text">{renderContent()}</div>
    </div>
  );
}
