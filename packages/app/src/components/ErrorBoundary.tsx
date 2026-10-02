import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Rover ErrorBoundary] Uncaught render error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 text-center select-none font-sans">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl mb-4 border border-rose-500/30">
            ⚠️
          </div>
          <h2 className="text-base font-bold text-zinc-100 mb-2">渲染异常 (Rendering Error)</h2>
          <p className="text-xs text-zinc-400 max-w-md mb-4 font-mono bg-zinc-900 border border-zinc-800 p-3 rounded-xl text-left overflow-x-auto">
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            刷新窗口 (Reload)
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
