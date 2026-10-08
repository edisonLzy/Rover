import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  RuntimeEventType,
  RuntimeEventEnvelope,
  RuntimeEventHandlers,
} from '@rover/runtime/expose';
import { trpc } from '../utils/trpc.js';

export interface RuntimeConnectionInfo {
  port: number;
  host: string;
  token: string;
  http_url: string;
  ws_url: string;
}

export interface RuntimeContextValue {
  connection: RuntimeConnectionInfo | null;
  loading: boolean;
  error: string | null;
  refreshConnection: () => Promise<void>;
  restartRuntime: () => Promise<void>;
  wsClient: RoverWebSocketClient;
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
  const [wsClient] = useState(() => new RoverWebSocketClient());

  useEffect(() => {
    if (!connection) {
      wsClient.disconnect();
      return;
    }
    wsClient.setConnection(connection.ws_url, connection.token);
    wsClient.connect();

    return () => {
      wsClient.disconnect();
    };
  }, [connection?.ws_url, connection?.token, wsClient]);

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
      if (isTauri()) {
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
      if (isTauri()) {
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
    if (isTauri()) {
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
    const url = connection ? `${connection.http_url}/trpc` : 'http://127.0.0.1:0/trpc';
    const token = connection ? connection.token : '';

    return trpc.createClient({
      links: [
        httpBatchLink({
          url,
          headers: () => (token ? { Authorization: `Bearer ${token}` } : {}),
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
      wsClient,
    }),
    [connection, loading, error, refreshConnection, restartRuntime, wsClient]
  );

  return (
    <RuntimeContext.Provider value={contextValue}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </trpc.Provider>
    </RuntimeContext.Provider>
  );
}

// ============================================================================
// WebSocket Client & Connection State Machine
// ============================================================================

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export interface WebSocketClientOptions {
  url?: string;
  token?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onEvent?: (event: unknown) => void;
  onLatency?: (latencyMs: number) => void;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export class RoverWebSocketClient {
  private ws: WebSocket | null = null;
  private options: WebSocketClientOptions;
  private status: ConnectionStatus = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimestamp: number | null = null;
  private latencyMs: number | null = null;
  private manuallyClosed = false;

  private readonly eventCallbacks = new Map<
    RuntimeEventType,
    Set<(payload: any, envelope: any) => void>
  >();
  private readonly stateCallbacks = new Set<() => void>();
  private readonly latencyCallbacks = new Set<(latencyMs: number) => void>();

  constructor(options?: WebSocketClientOptions) {
    this.options = {
      initialReconnectDelayMs: 500,
      maxReconnectDelayMs: 8000,
      heartbeatIntervalMs: 3000,
      ...options,
    };
  }

  public setConnection(url: string, token: string): void {
    const urlChanged = this.options.url !== url || this.options.token !== token;
    this.options.url = url;
    this.options.token = token;
    if (
      urlChanged &&
      (this.status === 'connected' ||
        this.status === 'connecting' ||
        this.status === 'reconnecting')
    ) {
      this.connect();
    }
  }

  public connect(endpoint?: { url: string; token: string }): void {
    if (endpoint) {
      this.options.url = endpoint.url;
      this.options.token = endpoint.token;
    }
    if (!this.options.url || !this.options.token) {
      return;
    }

    this.manuallyClosed = false;
    this.cleanupSocket();

    const wsUrl = new URL(this.options.url);
    wsUrl.searchParams.set('token', this.options.token);

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      const socket = new WebSocket(wsUrl.toString());
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeat();
      };

      socket.onmessage = (event: MessageEvent) => {
        if (this.ws !== socket) return;

        const dataStr = typeof event.data === 'string' ? event.data.trim() : '';

        // Handle pong heartbeat response
        if (dataStr === 'pong') {
          if (this.pingTimestamp !== null) {
            const latency = Math.max(1, Math.round(performance.now() - this.pingTimestamp));
            this.latencyMs = latency;
            this.options.onLatency?.(latency);
            this.latencyCallbacks.forEach((cb) => {
              try {
                cb(latency);
              } catch (err) {
                console.error('[RoverWebSocketClient] Error in latency listener:', err);
              }
            });
            this.pingTimestamp = null;
          }
          return;
        }

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed && typeof parsed === 'object') {
            if (parsed.type === 'pong') {
              if (this.pingTimestamp !== null) {
                const latency = Math.max(1, Math.round(performance.now() - this.pingTimestamp));
                this.latencyMs = latency;
                this.options.onLatency?.(latency);
                this.latencyCallbacks.forEach((cb) => {
                  try {
                    cb(latency);
                  } catch (err) {
                    console.error('[RoverWebSocketClient] Error in latency listener:', err);
                  }
                });
                this.pingTimestamp = null;
              }
            } else {
              this.options.onEvent?.(parsed);
              this.dispatchEvent(parsed);
            }
          }
        } catch {
          // Ignore unparseable raw messages
        }
      };

      socket.onclose = () => {
        if (this.ws !== socket) return;
        this.stopHeartbeat();
        this.setStatus('disconnected');

        if (!this.manuallyClosed) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        if (this.ws !== socket) return;
        this.stopHeartbeat();
        this.setStatus('disconnected');
      };
    } catch {
      this.setStatus('disconnected');
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * 批量注册强类型事件监听器
   * 返回一个无参注销函数，供 useEffect cleanup 调用
   */
  public registerEventHandler(handlers: RuntimeEventHandlers): () => void {
    const unregisterList: Array<() => void> = [];

    for (const [typeKey, handler] of Object.entries(handlers)) {
      if (!handler) continue;
      const type = typeKey as RuntimeEventType;
      let set = this.eventCallbacks.get(type);
      if (!set) {
        set = new Set();
        this.eventCallbacks.set(type, set);
      }
      const typedHandler = handler as (payload: unknown, envelope: unknown) => void;
      set.add(typedHandler);

      unregisterList.push(() => {
        const currentSet = this.eventCallbacks.get(type);
        if (currentSet) {
          currentSet.delete(typedHandler);
          if (currentSet.size === 0) {
            this.eventCallbacks.delete(type);
          }
        }
      });
    }

    return () => {
      for (const cleanup of unregisterList) {
        cleanup();
      }
    };
  }

  private dispatchEvent(event: unknown): void {
    if (!event || typeof event !== 'object') return;
    const envelope = event as RuntimeEventEnvelope;
    const callbacks = this.eventCallbacks.get(envelope.type);
    if (callbacks && callbacks.size > 0) {
      callbacks.forEach((callback) => {
        try {
          callback(envelope.payload, envelope);
        } catch (error) {
          console.error(`[RoverWebSocketClient] Error in listener for "${envelope.type}":`, error);
        }
      });
    }
    const wildcardCallbacks = this.eventCallbacks.get('*' as RuntimeEventType);
    if (wildcardCallbacks && wildcardCallbacks.size > 0) {
      wildcardCallbacks.forEach((callback) => {
        try {
          callback(envelope.payload, envelope);
        } catch (error) {
          console.error('[RoverWebSocketClient] Error in wildcard listener:', error);
        }
      });
    }
  }

  public getState = (): ConnectionStatus => this.status;

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getLatency(): number | null {
    return this.latencyMs;
  }

  public subscribeLatency = (callback: (latencyMs: number) => void): (() => void) => {
    this.latencyCallbacks.add(callback);
    return () => {
      this.latencyCallbacks.delete(callback);
    };
  };

  public subscribeState = (callback: () => void): (() => void) => {
    this.stateCallbacks.add(callback);
    return () => {
      this.stateCallbacks.delete(callback);
    };
  };

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.options.onStatusChange?.(newStatus);
      this.stateCallbacks.forEach((cb) => {
        try {
          cb();
        } catch (error) {
          console.error('[RoverWebSocketClient] Error in state listener:', error);
        }
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const baseDelay = this.options.initialReconnectDelayMs || 500;
    const maxDelay = this.options.maxReconnectDelayMs || 8000;
    // Exponential backoff with jitter
    const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(1.5, this.reconnectAttempts));
    const jitter = Math.random() * 200;
    const delay = Math.round(exponentialDelay + jitter);

    this.reconnectAttempts++;
    this.setStatus('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatIntervalMs || 3000;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.pingTimestamp = performance.now();
        this.ws.send('ping');
      }
    }, interval);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.pingTimestamp = performance.now();
      this.ws.send('ping');
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pingTimestamp = null;
  }

  private cleanupSocket(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  public disconnect(): void {
    this.manuallyClosed = true;
    this.cleanupSocket();
    this.setStatus('idle');
  }
}
