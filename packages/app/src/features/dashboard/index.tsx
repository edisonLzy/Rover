import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRuntime } from '../../context/RuntimeContext.js';
import { ProbeView } from './probe/index.js';
import { ModelsView } from './models/index.js';

type TabType = 'probe' | 'skills' | 'schedules' | 'memory' | 'models';

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
    <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex flex-col p-6 select-none overflow-hidden">
      {/* Top Header (Fixed) */}
      <header className="mb-6 flex justify-between items-center pb-4 border-b border-zinc-800 shrink-0">
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

      {/* Tab Navigation (Fixed) */}
      <nav className="flex items-center gap-1 mb-6 border-b border-zinc-800/80 pb-2 shrink-0">
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

      {/* Scrollable Main Area (Only this region scrolls) */}
      <main className="flex-1 overflow-y-auto min-h-0 pr-1">
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
          ) : activeTab === 'models' ? (
            <ModelsView />
          ) : (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 text-center text-zinc-400">
              <div className="text-2xl mb-2">🚧</div>
              <div className="text-sm font-semibold text-zinc-200 mb-1">
                {activeTab === 'skills' && 'Skill 目录模块'}
                {activeTab === 'schedules' && '定时计划管理'}
                {activeTab === 'memory' && '最近活动与会话追踪'}
              </div>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                此功能模块将在后续里程碑（M2/M3）中严格依照 TRD 规范落地。当前 M0 阶段核心验证
                双架构打包、环回通信、高熵鉴权与双窗口原生生命周期。
              </p>
            </div>
          )
        ) : null}
      </main>

      {/* Footer (Fixed at bottom) */}
      <footer className="mt-4 pt-4 border-t border-zinc-900 text-center text-xs text-zinc-600 flex justify-between items-center shrink-0">
        <span>Rover MVP • Milestone M0-5</span>
        <span className="text-[11px] text-zinc-500">关闭窗口将安全驻留于 macOS 系统托盘</span>
      </footer>
    </div>
  );
}
