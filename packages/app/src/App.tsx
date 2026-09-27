import React, { useEffect, useState, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { invoke } from '@tauri-apps/api/core';
import { trpc } from './utils/trpc';
import { RoverWebSocketClient, type ConnectionStatus } from './utils/websocket';

export interface RuntimeConnectionInfo {
  port: number;
  host: string;
  token: string;
  http_url: string;
  ws_url: string;
}

interface EventLog {
  id: string;
  time: string;
  type: string;
  payload: string;
}

function ProbeDashboard({ connection }: { connection: RuntimeConnectionInfo }) {
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('connecting');
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [showToken, setShowToken] = useState(false);

  // tRPC query to verify HTTP procedure & auth
  const healthQuery = trpc.health.useQuery(undefined, {
    refetchInterval: 3000,
    retry: 1,
  });

  // Setup WebSocket connection
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
          ...prev.slice(0, 19), // Keep last 20 events
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

        {/* WebSocket Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              WebSocket Event Stream
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                wsStatus === 'connected'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                  : wsStatus === 'reconnecting' || wsStatus === 'connecting'
                    ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                    : 'bg-rose-950 text-rose-400 border border-rose-800/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsStatus === 'connected' ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              {wsStatus.toUpperCase()}
            </span>
          </div>

          <div className="mt-4 space-y-2 text-sm text-zinc-300">
            <div className="flex justify-between">
              <span className="text-zinc-500">Stream Path:</span>
              <span className="font-mono text-zinc-200">/v1/events</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Heartbeat RTT:</span>
              <span className="font-mono text-emerald-400">
                {wsLatency !== null ? `${wsLatency} ms` : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Auto-Reconnect:</span>
              <span className="font-mono text-zinc-300">Active (Exponential Backoff)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Events Received:</span>
              <span className="font-mono text-zinc-300">{events.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Security & Credentials Panel */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
          Ephemeral Credentials & Loopback Security (ADR 0003 & 0007)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/60">
            <div className="text-zinc-500 mb-1">Allocated Port</div>
            <div className="text-emerald-400 text-sm">{connection.port}</div>
          </div>
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/60">
            <div className="text-zinc-500 mb-1">Binding Host</div>
            <div className="text-zinc-200 text-sm">{connection.host} (Loopback Only)</div>
          </div>
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/60">
            <div className="flex justify-between items-center mb-1">
              <span className="text-zinc-500">Memory Token</span>
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="text-zinc-400 hover:text-zinc-200 underline text-[10px]"
              >
                {showToken ? 'Hide' : 'Reveal'}
              </button>
            </div>
            <div className="text-zinc-300 text-xs truncate" title={connection.token}>
              {maskedToken}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Stream Terminal */}
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

export default function App() {
  const [connection, setConnection] = useState<RuntimeConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Query Client for tRPC
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

  useEffect(() => {
    async function initConnection() {
      try {
        // Attempt to fetch credentials from Tauri Rust host
        const info = await invoke<RuntimeConnectionInfo>('get_runtime_connection');
        setConnection(info);
      } catch (err) {
        // If running in standalone browser dev mode without Tauri host, check URL params
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
          setError(
            typeof err === 'string'
              ? err
              : (err as Error)?.message || 'Failed to connect to Tauri Rust host'
          );
        }
      } finally {
        setLoading(false);
      }
    }

    void initConnection();
  }, []);

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 flex flex-col justify-between select-none">
      <div>
        {/* Header */}
        <header className="mb-6 flex justify-between items-center pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm">
              R
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-100">Rover Engineering Probe</h1>
              <p className="text-xs text-zinc-500">
                M0-4: Direct Loopback Communication & Auto-Reconnect
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <span>macOS Desktop Host</span>
          </div>
        </header>

        {/* Content */}
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
          ) : connection && trpcClient ? (
            <trpc.Provider client={trpcClient} queryClient={queryClient}>
              <QueryClientProvider client={queryClient}>
                <ProbeDashboard connection={connection} />
              </QueryClientProvider>
            </trpc.Provider>
          ) : null}
        </main>
      </div>

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-zinc-900 text-center text-xs text-zinc-600">
        Rover MVP • Milestone M0 • End-to-End Type-Safe Architecture
      </footer>
    </div>
  );
}
