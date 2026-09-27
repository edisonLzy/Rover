import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { extractAuthToken } from './context.js';
import { RUNTIME_VERSION } from '../index.js';

export interface RuntimeEvent<T = unknown> {
  type: string;
  payload?: T;
  timestamp?: string;
}

export interface WebSocketManagerOptions {
  expectedToken: string;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private expectedToken: string;

  constructor(options: WebSocketManagerOptions) {
    this.expectedToken = options.expectedToken;
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws: WebSocket) => {
      // Send initial ready event upon connection
      const readyEvent: RuntimeEvent = {
        type: 'system.ready',
        payload: {
          version: RUNTIME_VERSION,
          status: 'ready',
        },
        timestamp: new Date().toISOString(),
      };
      ws.send(JSON.stringify(readyEvent));

      // Handle ping / heartbeat messages
      ws.on('message', (data) => {
        const messageStr = data.toString().trim();
        if (messageStr === 'ping') {
          ws.send('pong');
        } else {
          try {
            const parsed = JSON.parse(messageStr);
            if (parsed.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            }
          } catch {
            // Non-JSON plain message ignored
          }
        }
      });
    });
  }

  /**
   * Handles HTTP upgrade requests to /v1/events and validates authentication.
   */
  public handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url || '', `http://${req.headers.host || '127.0.0.1'}`);

    // Strictly match /v1/events
    if (url.pathname !== '/v1/events') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return false;
    }

    const token = extractAuthToken(req);
    if (!token || token !== this.expectedToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return false;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });

    return true;
  }

  /**
   * Broadcasts a runtime event to all connected clients.
   */
  public broadcast<T>(event: RuntimeEvent<T>): void {
    const eventWithTimestamp: RuntimeEvent<T> = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    const payload = JSON.stringify(eventWithTimestamp);

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Closes all active WebSocket connections.
   */
  public close(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.wss.clients) {
        client.close(1000, 'Server shutting down');
      }
      this.wss.close(() => resolve());
    });
  }

  public getConnectedClientsCount(): number {
    return this.wss.clients.size;
  }
}
