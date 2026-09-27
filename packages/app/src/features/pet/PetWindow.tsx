import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRuntime } from '../../context/RuntimeContext';
import { trpc } from '../../utils/trpc';
import { RoverWebSocketClient, type ConnectionStatus } from '../../utils/websocket';

export function PetWindow() {
  const { connection, loading, error } = useRuntime();
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('connecting');
  const [wsLatency, setWsLatency] = useState<number | null>(null);

  // tRPC health query (safely disabled until connection info is loaded)
  const healthQuery = trpc.health.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
  });

  // WebSocket connection for real-time state
  useEffect(() => {
    if (!connection) return;

    const client = new RoverWebSocketClient({
      url: connection.ws_url,
      token: connection.token,
      onStatusChange: (status) => setWsStatus(status),
      onLatency: (ms) => setWsLatency(ms),
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
              <span>{isOnline ? 'Rover 已就绪' : loading ? '连接 Runtime 中...' : '连接离线'}</span>
            </div>
            <p className="text-xs text-zinc-400 truncate mt-0.5">
              {isOnline
                ? `环回通信延迟 ${wsLatency !== null ? `${wsLatency}ms` : '<1ms'} • 常驻后台`
                : error || '正在等待 Node.js Sidecar 启动...'}
            </p>
          </div>
        </div>

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

        {/* Quick prompt input placeholder (Prepared for M2) */}
        <div className="relative">
          <input
            type="text"
            disabled
            placeholder="呼唤 Rover 或输入指令... (M2 开启)"
            className="w-full rounded-xl bg-zinc-950/80 border border-zinc-800 px-3 py-2 text-xs text-zinc-400 placeholder-zinc-600 cursor-not-allowed focus:outline-none"
          />
          <span className="absolute right-2.5 top-2 text-[10px] text-zinc-600 font-mono">⌘K</span>
        </div>
      </div>
    </div>
  );
}
