import { useState, useMemo } from 'react';
import { RuntimeProvider } from './context/RuntimeContext';
import { PetWindow } from './windows/PetWindow';
import { DashboardWindow } from './windows/DashboardWindow';
import { isTauriEnvironment, resolveInitialWindowLabel } from './utils/window';

export default function App() {
  const isTauri = isTauriEnvironment();
  const initialLabel = useMemo(() => resolveInitialWindowLabel(), []);
  const [windowLabel, setWindowLabel] = useState<string>(initialLabel);

  return (
    <RuntimeProvider>
      {/* Standalone browser dev mode switcher */}
      {!isTauri && (
        <div className="fixed top-2 right-2 z-50 flex items-center gap-1 bg-zinc-900/90 border border-zinc-700/80 rounded-full px-2 py-1 shadow-lg text-xs backdrop-blur-md">
          <span className="text-[10px] text-zinc-500 uppercase px-1 font-mono">Dev Mode</span>
          <button
            onClick={() => setWindowLabel('main')}
            className={`px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
              windowLabel === 'main'
                ? 'bg-emerald-600 text-white font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            🐾 宠物
          </button>
          <button
            onClick={() => setWindowLabel('dashboard')}
            className={`px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
              windowLabel === 'dashboard'
                ? 'bg-emerald-600 text-white font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            📊 控制台
          </button>
        </div>
      )}

      {/* View Dispatcher based on Window Label */}
      {windowLabel === 'main' ? <PetWindow /> : <DashboardWindow />}
    </RuntimeProvider>
  );
}
