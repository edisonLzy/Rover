import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { trpc } from '../utils/trpc';

export interface RuntimeConnectionInfo {
  port: number;
  host: string;
  token: string;
  http_url: string;
  ws_url: string;
}

interface RuntimeContextValue {
  connection: RuntimeConnectionInfo | null;
  loading: boolean;
  error: string | null;
  refreshConnection: () => Promise<void>;
  restartRuntime: () => Promise<void>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) {
    throw new Error('useRuntime must be used within a RuntimeProvider');
  }
  return ctx;
}

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnection] = useState<RuntimeConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
          },
        },
      }),
    []
  );

  const refreshConnection = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (isTauri) {
        const info = await invoke<RuntimeConnectionInfo>('get_runtime_connection');
        setConnection(info);
      } else {
        // Fallback for standalone browser development (pnpm dev:web)
        const params = new URLSearchParams(window.location.search);
        const port = params.get('port');
        const token = params.get('token');
        if (port && token) {
          setConnection({
            port: Number(port),
            host: '127.0.0.1',
            token,
            http_url: `http://127.0.0.1:${port}`,
            ws_url: `ws://127.0.0.1:${port}/v1/events`,
          });
        } else {
          setError('Browser dev mode: please provide ?port=...&token=... query parameters.');
        }
      }
    } catch (err) {
      setError(
        typeof err === 'string'
          ? err
          : (err as Error)?.message || 'Failed to acquire connection from Rust host'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const restartRuntime = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (isTauri) {
        const newInfo = await invoke<RuntimeConnectionInfo>('restart_runtime');
        setConnection(newInfo);
      } else {
        await refreshConnection();
      }
    } catch (err) {
      setError(
        typeof err === 'string' ? err : (err as Error)?.message || 'Failed to restart runtime'
      );
    } finally {
      setLoading(false);
    }
  }, [refreshConnection]);

  // Initial connection fetch and listen to runtime_restarted event from Rust host
  useEffect(() => {
    void refreshConnection();

    let unlistenFn: (() => void) | undefined;
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      listen('runtime_restarted', () => {
        console.log('[RuntimeContext] runtime_restarted event received from Rust, refreshing...');
        void refreshConnection();
      })
        .then((fn) => {
          unlistenFn = fn;
        })
        .catch((e) => {
          console.error('[RuntimeContext] Failed to listen to runtime_restarted:', e);
        });
    }

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [refreshConnection]);

  const trpcClient = useMemo(() => {
    if (!connection) return null;

    return trpc.createClient({
      links: [
        httpBatchLink({
          url: `${connection.http_url}/trpc`,
          headers: () => ({
            Authorization: `Bearer ${connection.token}`,
          }),
        }),
      ],
    });
  }, [connection]);

  const contextValue = useMemo(
    () => ({
      connection,
      loading,
      error,
      refreshConnection,
      restartRuntime,
    }),
    [connection, loading, error, refreshConnection, restartRuntime]
  );

  return (
    <RuntimeContext.Provider value={contextValue}>
      {connection && trpcClient ? (
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </trpc.Provider>
      ) : (
        children
      )}
    </RuntimeContext.Provider>
  );
}
