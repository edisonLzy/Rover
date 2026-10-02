import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRuntime, type RuntimeConnectionInfo } from '../../context/RuntimeContext.js';
import { trpc } from '../../utils/trpc.js';
import { RoverWebSocketClient, type ConnectionStatus } from '../../utils/websocket.js';

interface EventLog {
  id: string;
  time: string;
  type: string;
  payload: string;
}

type TabType = 'probe' | 'skills' | 'schedules' | 'memory' | 'models';

function ProbeView({ connection }: { connection: RuntimeConnectionInfo }) {
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('connecting');
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [showToken, setShowToken] = useState(false);

  const healthQuery = trpc.health.useQuery(undefined, {
    refetchInterval: 3000,
    retry: 1,
  });

  useEffect(() => {
    const client = new RoverWebSocketClient({
      url: connection.ws_url,
      token: connection.token,
      onStatusChange: (status) => setWsStatus(status),
      onLatency: (ms) => setWsLatency(ms),
      onEvent: (event) => {
        const evtObj = event as { type?: string; payload?: unknown };
        setEvents((prev) => [
          {
            id: Math.random().toString(36).slice(2, 9),
            time: new Date().toLocaleTimeString(),
            type: evtObj.type || 'unknown',
            payload: JSON.stringify(evtObj.payload ?? event),
          },
          ...prev.slice(0, 19),
        ]);
      },
    });

    client.connect();
    return () => {
      client.disconnect();
    };
  }, [connection.ws_url, connection.token]);

  const maskedToken = showToken
    ? connection.token
    : `${connection.token.slice(0, 8)}••••••••••••••••${connection.token.slice(-4)}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* HTTP / tRPC Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              tRPC (Loopback HTTP)
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                healthQuery.isSuccess
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                  : healthQuery.isPending
                    ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                    : 'bg-rose-950 text-rose-400 border border-rose-800/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  healthQuery.isSuccess ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              {healthQuery.isSuccess
                ? 'Connected (200 OK)'
                : healthQuery.isPending
                  ? 'Probing...'
                  : 'Error'}
            </span>
          </div>

          <div className="mt-4 space-y-2 text-sm text-zinc-300">
            <div className="flex justify-between">
              <span className="text-zinc-500">Endpoint:</span>
              <span className="font-mono text-zinc-200">{connection.http_url}/trpc</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Runtime Status:</span>
              <span className="font-mono text-emerald-400">
                {healthQuery.data?.status || (healthQuery.isPending ? 'checking...' : 'failed')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Version:</span>
              <span className="font-mono text-zinc-300">{healthQuery.data?.version || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Uptime:</span>
              <span className="font-mono text-zinc-300">
                {healthQuery.data?.uptime !== undefined
                  ? `${Math.round(healthQuery.data.uptime)}s`
                  : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* WebSocket Stream Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              WebSocket (Events Transport)
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                wsStatus === 'connected'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                  : wsStatus === 'connecting'
                    ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                    : 'bg-rose-950 text-rose-400 border border-rose-800/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsStatus === 'connected' ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              {wsStatus === 'connected'
                ? `Connected (${wsLatency !== null ? `${wsLatency}ms` : 'ok'})`
                : wsStatus === 'connecting'
                  ? 'Connecting...'
                  : 'Disconnected'}
            </span>
          </div>

          <div className="mt-4 space-y-2 text-sm text-zinc-300">
            <div className="flex justify-between">
              <span className="text-zinc-500">WebSocket URL:</span>
              <span className="font-mono text-zinc-200">{connection.ws_url}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Heartbeat Ping:</span>
              <span className="font-mono text-emerald-400">30s interval</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Auto-Reconnect:</span>
              <span className="font-mono text-zinc-300">Exponential backoff</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Latency:</span>
              <span className="font-mono text-zinc-300">
                {wsLatency !== null ? `${wsLatency}ms` : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Security Credentials Card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex justify-between items-center mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Loopback Authentication Guard (ADR-0007)
          </span>
          <button
            onClick={() => setShowToken(!showToken)}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
          >
            {showToken ? 'Hide Token' : 'Reveal Token'}
          </button>
        </div>
        <div className="bg-zinc-950 rounded-lg p-3 font-mono text-xs border border-zinc-800 flex justify-between items-center text-zinc-300 overflow-x-auto">
          <span className="truncate mr-4">{maskedToken}</span>
          <span className="text-[10px] text-zinc-500 uppercase px-2 py-0.5 bg-zinc-800 rounded">
            Bearer
          </span>
        </div>
      </div>

      {/* Live Event Feed */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs shadow-inner">
        <div className="flex justify-between items-center pb-2 mb-3 border-b border-zinc-800/60 text-zinc-400">
          <span>Live WebSocket Events Feed</span>
          <span className="text-[11px] text-zinc-600">{events.length} recorded</span>
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {events.length === 0 ? (
            <div className="text-zinc-600 py-3 text-center">Listening for runtime events...</div>
          ) : (
            events.map((evt) => (
              <div key={evt.id} className="flex gap-2 text-zinc-300">
                <span className="text-zinc-600">[{evt.time}]</span>
                <span className="text-emerald-400 font-semibold">{evt.type}</span>
                <span className="text-zinc-400 truncate">{evt.payload}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function DashboardWindow() {
  const { connection, loading, error, restartRuntime } = useRuntime();
  const [activeTab, setActiveTab] = useState<TabType>('probe');
  const [restarting, setRestarting] = useState(false);

  const handleRestorePet = async () => {
    try {
      await invoke('show_window', { label: 'main' });
    } catch (e) {
      console.error('Failed to show pet window:', e);
    }
  };

  const handleRestartRuntime = async () => {
    try {
      setRestarting(true);
      await restartRuntime();
    } catch (e) {
      console.error('Failed to restart runtime:', e);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between p-6 select-none overflow-y-auto">
      <div>
        {/* Top Header */}
        <header className="mb-6 flex justify-between items-center pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-base shadow-sm">
              🐕
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-zinc-100">Rover Control Center</h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono">
                  M0-5 Dual-Window
                </span>
              </div>
              <p className="text-xs text-zinc-500">macOS 桌面管理中枢 • 独立持久化运行环境</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRestorePet}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>🐾</span>
              <span>恢复宠物窗口</span>
            </button>
            <button
              onClick={handleRestartRuntime}
              disabled={restarting}
              className="px-3 py-1.5 rounded-lg border border-emerald-700/60 bg-emerald-950/60 hover:bg-emerald-900/60 text-xs text-emerald-300 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>🔄</span>
              <span>{restarting ? '重启中...' : '重启 Runtime'}</span>
            </button>
          </div>
        </header>

        {/* Tab Navigation */}
        <nav className="flex items-center gap-1 mb-6 border-b border-zinc-800/80 pb-2">
          {[
            { id: 'probe', label: '系统探针 (Probe)' },
            { id: 'skills', label: 'Skill 目录' },
            { id: 'schedules', label: '定时计划' },
            { id: 'memory', label: '最近活动' },
            { id: 'models', label: '模型配置' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-zinc-800 text-zinc-100 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content Body */}
        <main>
          {loading ? (
            <div className="py-20 text-center text-zinc-500 text-sm">
              <div className="inline-block animate-spin w-5 h-5 border-2 border-zinc-600 border-t-emerald-400 rounded-full mb-3" />
              <div>Acquiring runtime connection from Rust host...</div>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-5 text-sm">
              <div className="font-semibold text-rose-400 mb-1">Connection Error</div>
              <p className="text-zinc-400 text-xs mb-3">{error}</p>
              <p className="text-zinc-500 text-xs">
                Make sure you run the app via <code className="text-zinc-300">pnpm dev</code> (which
                boots both Rust and Node sidecar) or pass{' '}
                <code className="text-zinc-300">?port=...&token=...</code> in browser development
                mode.
              </p>
            </div>
          ) : connection ? (
            activeTab === 'probe' ? (
              <ProbeView connection={connection} />
            ) : (
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 text-center text-zinc-400">
                <div className="text-2xl mb-2">🚧</div>
                <div className="text-sm font-semibold text-zinc-200 mb-1">
                  {activeTab === 'skills' && 'Skill 目录模块'}
                  {activeTab === 'schedules' && '定时计划管理'}
                  {activeTab === 'memory' && '最近活动与会话追踪'}
                  {activeTab === 'models' && '模型与提供商配置'}
                </div>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  此功能模块将在后续里程碑（M2/M3）中严格依照 TRD 规范落地。当前 M0 阶段核心验证
                  双架构打包、环回通信、高熵鉴权与双窗口原生生命周期。
                </p>
              </div>
            )
          ) : null}
        </main>
      </div>

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-zinc-900 text-center text-xs text-zinc-600 flex justify-between items-center">
        <span>Rover MVP • Milestone M0-5</span>
        <span className="text-[11px] text-zinc-500">关闭窗口将安全驻留于 macOS 系统托盘</span>
      </footer>
    </div>
  );
}
