import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Archive,
  RefreshCw,
  Layers,
  ArrowUpDown,
  History,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import { trpc } from '../../../utils/trpc.js';
import { useRuntime } from '../../../context/RuntimeContext.js';
import { RoverWebSocketClient } from '../../../utils/websocket.js';
import { UserMessageItem } from './UserMessageItem.js';
import { AssistantMessageItem } from './AssistantMessageItem.js';
import { ToolResultItem } from './ToolResultItem.js';
import { CompactionItem } from './CompactionItem.js';
import { RawJsonModal } from './RawJsonModal.js';

type FilterType = 'all' | 'message' | 'compaction';
type OrderType = 'asc' | 'desc';

export function HistoryView() {
  const { connection } = useRuntime();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedTurnId, setSelectedTurnId] = useState<string>('all');
  const [order, setOrder] = useState<OrderType>('asc');
  const [inspectEntry, setInspectEntry] = useState<any | null>(null);

  // Queries
  const { data: stats, refetch: refetchStats } = trpc.history.getStats.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const { data: turnsData } = trpc.history.listTurns.useQuery({ limit: 50 });

  const {
    data: entries,
    isLoading,
    isRefetching,
    refetch: refetchFeed,
  } = trpc.history.getFeed.useQuery(
    {
      limit: 100,
      turnId: selectedTurnId === 'all' ? undefined : selectedTurnId,
      type: filterType === 'all' ? undefined : filterType,
      order,
    },
    {
      refetchInterval: 6000,
    }
  );

  const handleRefresh = () => {
    refetchStats();
    refetchFeed();
  };

  // Live WebSocket update on events
  useEffect(() => {
    if (!connection) return;

    const client = new RoverWebSocketClient({
      url: connection.ws_url,
      token: connection.token,
      onEvent: (event) => {
        const evt = event as { type?: string };
        if (
          evt.type === 'rover.entry.appended' ||
          evt.type === 'rover.compaction.appended' ||
          evt.type === 'turn.started' ||
          evt.type === 'turn.end'
        ) {
          handleRefresh();
        }
      },
    });

    client.connect();
    return () => {
      client.disconnect();
    };
  }, [connection]);

  return (
    <div className="flex flex-col gap-5 pb-8 select-none">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-xs">交互总条目</span>
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl font-bold font-mono text-zinc-100">
            {stats?.totalEntries ?? 0}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
            最新 Seq: #{stats?.latestSeq ?? 0}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-xs">对话消息数</span>
            <MessageSquare className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-zinc-100">
            {stats?.totalMessages ?? 0}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">User / Assistant / Tool</div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-xs">记忆压缩快照</span>
            <Archive className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold font-mono text-zinc-100">
            {stats?.totalCompactions ?? 0}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">ADR-0014 边界截断</div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-xs">对话回合</span>
            <RotateCw className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-bold font-mono text-zinc-100">{stats?.totalTurns ?? 0}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Prompt 回合生命周期</div>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type Filters */}
          <div className="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800/80">
            {[
              { id: 'all', label: '全部' },
              { id: 'message', label: '仅消息' },
              { id: 'compaction', label: '仅压缩快照' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id as FilterType)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  filterType === f.id
                    ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Turn Filter Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-500">回合:</span>
            <select
              value={selectedTurnId}
              onChange={(e) => setSelectedTurnId(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 focus:outline-hidden focus:border-emerald-500 transition-colors cursor-pointer"
            >
              <option value="all">所有回合 (All Turns)</option>
              {(turnsData || []).map((t) => (
                <option key={t.id} value={t.id}>
                  Turn: {t.id.slice(0, 8)} ({t.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Order Toggle */}
          <button
            onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-800/80 text-xs text-zinc-300 transition-colors cursor-pointer"
            title="切换排序方向"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
            <span>{order === 'asc' ? '正序 (早期在前)' : '倒序 (最新在前)'}</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-800/80 text-xs text-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin text-emerald-400' : ''}`}
            />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* Feed List Area */}
      <div className="flex flex-col gap-3 min-h-[300px]">
        {isLoading ? (
          <div className="py-20 text-center text-zinc-500 text-xs">
            <div className="inline-block animate-spin w-5 h-5 border-2 border-zinc-600 border-t-emerald-400 rounded-full mb-3" />
            <div>正在加载历史交互条目...</div>
          </div>
        ) : !entries || entries.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-12 text-center text-zinc-500">
            <History className="w-10 h-10 mx-auto mb-3 text-zinc-600 stroke-1" />
            <div className="text-sm font-semibold text-zinc-300 mb-1">暂无对话历史记录</div>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mb-4">
              在宠物窗口中与 Rover 发送对话指令，所有 User、Assistant、受控工具执行与 Compaction
              条目将实时依照 ADR-0014 先行落盘并展示于此。
            </p>
            <div className="inline-flex items-center gap-1 text-[11px] text-emerald-400/80 bg-emerald-950/40 border border-emerald-800/40 px-3 py-1 rounded-full font-mono">
              <Sparkles className="w-3 h-3" />
              <span>SQLite WAL 模式持久化保证</span>
            </div>
          </div>
        ) : (
          entries.map((entry) => {
            if (entry.type === 'compaction') {
              return (
                <CompactionItem
                  key={entry.id}
                  entry={entry}
                  onInspect={() => setInspectEntry(entry)}
                />
              );
            }

            const role = (entry.data as any)?.role;
            if (role === 'user') {
              return (
                <UserMessageItem
                  key={entry.id}
                  entry={entry}
                  onInspect={() => setInspectEntry(entry)}
                />
              );
            }

            if (role === 'assistant') {
              return (
                <AssistantMessageItem
                  key={entry.id}
                  entry={entry}
                  onInspect={() => setInspectEntry(entry)}
                />
              );
            }

            if (role === 'toolResult') {
              return (
                <ToolResultItem
                  key={entry.id}
                  entry={entry}
                  onInspect={() => setInspectEntry(entry)}
                />
              );
            }

            // Fallback for generic message
            return (
              <div
                key={entry.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-xs font-mono text-zinc-400"
              >
                <div className="flex justify-between items-center mb-2">
                  <span>
                    Entry #{entry.seq} ({entry.type})
                  </span>
                  <button
                    onClick={() => setInspectEntry(entry)}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    JSON
                  </button>
                </div>
                <pre>{JSON.stringify(entry.data, null, 2)}</pre>
              </div>
            );
          })
        )}
      </div>

      {/* Raw JSON Modal */}
      <RawJsonModal
        isOpen={inspectEntry !== null}
        onClose={() => setInspectEntry(null)}
        data={inspectEntry}
        title={inspectEntry ? `Entry #${inspectEntry.seq} (${inspectEntry.id})` : ''}
      />
    </div>
  );
}
