import { useState, useEffect } from 'react';
import type { RuntimeConnectionInfo } from '../../../context/RuntimeContext.js';
import { trpc } from '../../../utils/trpc.js';
import { RoverWebSocketClient, type ConnectionStatus } from '../../../utils/websocket.js';

interface EventLog {
  id: string;
  time: string;
  type: string;
  payload: string;
}

export function ProbeView({ connection }: { connection: RuntimeConnectionInfo }) {
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
