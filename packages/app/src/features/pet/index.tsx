import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRuntime } from '../../context/RuntimeContext.js';
import { trpc } from '../../utils/trpc.js';
import { RoverWebSocketClient, type ConnectionStatus } from '../../utils/websocket.js';
import { PromptInput } from './editor/PromptInput.js';
import type { SuggestionItemData } from './editor/types.js';

const DEFAULT_AGENTS: SuggestionItemData[] = [
  { id: 'claude-code', kind: 'agent', label: 'Claude Code', description: 'Anthropic Coding CLI' },
  { id: 'codex', kind: 'agent', label: 'Codex CLI', description: 'OpenAI Code Generator' },
];

const DEFAULT_SKILLS: SuggestionItemData[] = [
  {
    id: 'agent-dispatch',
    kind: 'skill',
    label: 'agent-dispatch',
    description: '智能派发任务给 Coding Agent',
  },
  {
    id: 'task-recall',
    kind: 'skill',
    label: 'task-recall',
    description: '查询和回忆历史任务上下文',
  },
];

export function PetWindow() {
  const { connection, loading, error } = useRuntime();
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('connecting');
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [turnStatusText, setTurnStatusText] = useState<string | null>(null);
  const [isErrorStatus, setIsErrorStatus] = useState(false);
  const finishedTurnIdsRef = useRef<Set<string>>(new Set());

  // tRPC health query (safely disabled until connection info is loaded)
  const healthQuery = trpc.health.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
  });

  // tRPC active model query to detect whether a model is configured and active
  const activeModelQuery = trpc.models.getActive.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
  });

  const hasActiveModel = Boolean(activeModelQuery.data?.hasActiveModel);
  const activeModel = activeModelQuery.data?.activeModel;

  const startTurnMutation = trpc.turns.start.useMutation({
    onSuccess: (data) => {
      // Race-condition guard: If turn.end arrived before HTTP response, do not lock activeTurnId
      if (finishedTurnIdsRef.current.has(data.turnId)) {
        return;
      }
      setActiveTurnId(data.turnId);
      setIsErrorStatus(false);
      setTurnStatusText('Rover 启动中...');
    },
    onError: (err) => {
      setActiveTurnId(null);
      setIsErrorStatus(true);
      const msg = err.message.includes('No active model')
        ? '未配置激活模型，请前往控制面板配置'
        : err.message;
      setTurnStatusText(`启动失败: ${msg}`);
      setTimeout(() => {
        setTurnStatusText(null);
        setIsErrorStatus(false);
      }, 5000);
    },
  });

  // WebSocket connection for real-time state
  useEffect(() => {
    if (!connection) return;

    const client = new RoverWebSocketClient({
      url: connection.ws_url,
      token: connection.token,
      onStatusChange: (status) => setWsStatus(status),
      onLatency: (ms) => setWsLatency(ms),
      onEvent: (event: any) => {
        if (event.type === 'turn.started') {
          const tId = event.payload?.turnId ?? null;
          setActiveTurnId(tId);
          setIsErrorStatus(false);
          setTurnStatusText('思考中...');
        } else if (event.type === 'turn.delta') {
          setIsErrorStatus(false);
          setTurnStatusText(event.payload?.isThinking ? '思考中...' : '回复中...');
        } else if (event.type === 'turn.end') {
          const { turnId, status, error: turnError } = event.payload || {};
          if (turnId) {
            finishedTurnIdsRef.current.add(turnId);
          }
          setActiveTurnId((prev) => (prev === turnId || !turnId ? null : prev));

          if (status === 'failed' || turnError) {
            setIsErrorStatus(true);
            const displayError = turnError?.includes('No active model')
              ? '未配置激活模型，请前往配置'
              : turnError || '执行失败';
            setTurnStatusText(`回合失败: ${displayError}`);
            setTimeout(() => {
              setTurnStatusText(null);
              setIsErrorStatus(false);
            }, 6000);
          } else {
            setIsErrorStatus(false);
            setTurnStatusText('回复完成');
            setTimeout(() => setTurnStatusText(null), 3000);
          }
        }
      },
    });

    client.connect();
    return () => {
      client.disconnect();
    };
  }, [connection]);

  const handleOpenDashboard = async () => {
    try {
      await invoke('show_window', { label: 'dashboard' });
    } catch (e) {
      console.error('Failed to open dashboard window:', e);
    }
  };

  const handleHidePet = async () => {
    try {
      await invoke('hide_window', { label: 'main' });
    } catch (e) {
      console.error('Failed to hide pet window:', e);
    }
  };

  const isOnline = !loading && !error && healthQuery.isSuccess && wsStatus === 'connected';

  return (
    <div className="w-full h-full bg-transparent flex flex-col justify-center items-center p-3 select-none">
      {/* Floating Pet Card / Island */}
      <div className="w-full rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-4 text-zinc-100 flex flex-col gap-3">
        {/* Header & Drag Handle */}
        <div
          data-tauri-drag-region
          className="flex items-center justify-between pb-2 border-b border-zinc-800 cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2 pointer-events-none">
            {/* Status indicator dot */}
            <span className="relative flex h-2.5 w-2.5">
              {isOnline && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isOnline ? 'bg-emerald-500' : loading ? 'bg-amber-500' : 'bg-rose-500'
                }`}
              />
            </span>
            <span className="text-xs font-bold tracking-wide text-zinc-200">Rover Pet</span>
            <span className="text-[10px] text-zinc-500 font-mono">v0.1.0</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenDashboard}
              title="打开 Dashboard 管理面板"
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-xs cursor-pointer"
            >
              📊
            </button>
            <button
              onClick={handleHidePet}
              title="隐藏宠物（可通过菜单栏恢复）"
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors text-xs font-mono cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Pet Avatar & Status Card */}
        <div className="flex items-center gap-3.5 py-1">
          <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-700/20 border border-emerald-500/30 flex items-center justify-center text-2xl shadow-inner select-none">
            🐕
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
              <span>
                {isOnline
                  ? hasActiveModel
                    ? 'Rover 已就绪'
                    : '未检测到激活模型'
                  : loading
                    ? '连接 Runtime 中...'
                    : '连接离线'}
              </span>
              {turnStatusText && (
                <span
                  className={`text-[11px] font-normal px-2 py-0.5 rounded-full border ${
                    isErrorStatus
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 animate-pulse'
                  }`}
                >
                  {turnStatusText}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 truncate mt-0.5">
              {isOnline
                ? turnStatusText
                  ? isErrorStatus
                    ? turnStatusText
                    : '回答生成中，可打开 Dashboard 查阅完整记录'
                  : !hasActiveModel
                    ? '尚未在 ~/.rover/models.json 配置或激活大模型'
                    : activeModel
                      ? `当前模型: ${activeModel.name || activeModel.id} (${activeModel.provider})`
                      : `环回通信延迟 ${wsLatency !== null ? `${wsLatency}ms` : '<1ms'} • 常驻后台`
                : error || '正在等待 Node.js Sidecar 启动...'}
            </p>
          </div>
        </div>

        {/* Warning Banner when no active model is configured */}
        {isOnline && !hasActiveModel && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-center justify-between gap-2 text-xs text-amber-300 shadow-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 text-sm">⚠️</span>
              <span className="truncate text-[11px]">未检测到激活大模型，请先配置后开始使用。</span>
            </div>
            <button
              onClick={handleOpenDashboard}
              type="button"
              className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-medium transition-colors border border-amber-500/30 cursor-pointer"
            >
              前往配置
            </button>
          </div>
        )}

        {/* Status Chips */}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="rounded-lg bg-zinc-950/80 border border-zinc-800/80 p-2 flex flex-col justify-between">
            <span className="text-zinc-500">tRPC HTTP</span>
            <span
              className={`font-semibold ${healthQuery.isSuccess ? 'text-emerald-400' : 'text-zinc-400'}`}
            >
              {healthQuery.isSuccess ? '200 OK' : healthQuery.isPending ? 'Probing...' : 'Error'}
            </span>
          </div>
          <div className="rounded-lg bg-zinc-950/80 border border-zinc-800/80 p-2 flex flex-col justify-between">
            <span className="text-zinc-500">Events WS</span>
            <span
              className={`font-semibold ${wsStatus === 'connected' ? 'text-emerald-400' : 'text-zinc-400'}`}
            >
              {wsStatus === 'connected' ? (wsLatency ? `${wsLatency}ms` : 'Active') : wsStatus}
            </span>
          </div>
        </div>

        {/* Native Tiptap 3 Prompt Input */}
        <PromptInput
          placeholder={
            !hasActiveModel && isOnline
              ? '未配置激活模型，请点击上方按钮前往配置...'
              : activeTurnId
                ? 'Rover 正在生成回答中...'
                : '呼唤 Rover 或输入指令，按 @ 派发，/ 技能...'
          }
          availableAgents={DEFAULT_AGENTS}
          availableSkills={DEFAULT_SKILLS}
          disabled={startTurnMutation.isPending || !!activeTurnId}
          onSubmit={(doc) => {
            if (!hasActiveModel) {
              setIsErrorStatus(true);
              setTurnStatusText('无法发送：未配置激活模型，请先配置');
              setTimeout(() => {
                setTurnStatusText(null);
                setIsErrorStatus(false);
              }, 4000);
              return false;
            }
            startTurnMutation.mutate({ promptDoc: doc });
          }}
        />
      </div>
    </div>
  );
}
