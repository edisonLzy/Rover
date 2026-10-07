import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { createContext, extractAuthToken } from './context.js';
import { appRouter } from './router.js';
import { WebSocketManager, type RuntimeEvent } from './websocket.js';
import { getDefaultAgentRuntime } from '../modules/agent/index.js';
import { RUNTIME_VERSION } from '../index.js';
import { getDefaultContainer, type Container } from '../container.js';

export interface RuntimeServerOptions {
  port?: number;
  token: string;
  host?: string;
  skillsDir?: string;
  container?: Container;
}

export interface ServerAddress {
  port: number;
  host: string;
  token: string;
  httpUrl: string;
  wsUrl: string;
}

/**
 * Validates if an Origin is an authorized loopback or Tauri origin.
 */
export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true; // Direct non-browser requests (curl, server-to-server) allowed

  try {
    const parsed = new URL(origin);
    // Allow loopback hostnames
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      return true;
    }
    // Allow standard Tauri WebView origins
    if (parsed.protocol === 'tauri:' || parsed.hostname.endsWith('tauri.localhost')) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export class RuntimeServer {
  private server: http.Server;
  private wsManager: WebSocketManager;
  private container: Container;
  private port: number;
  private host: string;
  private token: string;
  private running = false;

  constructor(options: RuntimeServerOptions) {
    if (!options.token || options.token.trim().length === 0) {
      throw new Error('RuntimeServer requires a non-empty auth token');
    }

    this.port = options.port ?? 0;
    this.host = options.host ?? '127.0.0.1';
    this.token = options.token.trim();

    // Strictly enforce loopback binding for security
    if (this.host === '0.0.0.0') {
      throw new Error(
        'Binding to 0.0.0.0 is prohibited. Runtime server must only bind to 127.0.0.1'
      );
    }

    this.container =
      options.container ??
      getDefaultContainer({
        skillsDir: options.skillsDir,
      });

    this.wsManager = new WebSocketManager({ expectedToken: this.token });
    getDefaultAgentRuntime(
      options.skillsDir === undefined ? undefined : { skillsDir: options.skillsDir }
    ).setWebSocketManager(this.wsManager);
    this.server = http.createServer(this.handleHttpRequest.bind(this));

    this.server.on('upgrade', (req, socket, head) => {
      this.wsManager.handleUpgrade(req, socket, head);
    });
  }

  public getContainer(): Container {
    return this.container;
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;

    // 1. CORS check & headers
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Standard security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const hostHeader = req.headers.host || `${this.host}:${this.port}`;
    const url = new URL(req.url || '/', `http://${hostHeader}`);

    // 2. Direct REST health endpoint: /api/v1/health
    if (url.pathname === '/api/v1/health') {
      const token = extractAuthToken(req);
      if (!token || token !== this.token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid loopback token' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          version: RUNTIME_VERSION,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // 3. tRPC API: /trpc/*
    if (url.pathname.startsWith('/trpc')) {
      const trpcPath = url.pathname.slice('/trpc/'.length);
      return void nodeHTTPRequestHandler({
        req,
        res,
        router: appRouter,
        path: trpcPath,
        createContext: () =>
          createContext({
            req,
            res,
            expectedToken: this.token,
            container: this.container,
          }),
      });
    }

    // 4. Default 404 for unrecognized paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  /**
   * Starts listening on the configured loopback host and port.
   */
  public start(): Promise<ServerAddress> {
    return new Promise((resolve, reject) => {
      if (this.running) {
        return resolve(this.getAddress());
      }

      this.server.listen(this.port, this.host, () => {
        this.running = true;
        const address = this.server.address() as AddressInfo;
        this.port = address.port;
        this.host = address.address;
        resolve(this.getAddress());
      });

      this.server.once('error', (err) => {
        this.running = false;
        reject(err);
      });
    });
  }

  /**
   * Broadcasts a runtime event via WebSocket to all connected frontend clients.
   */
  public broadcast<T>(event: RuntimeEvent<T>): void {
    this.wsManager.broadcast(event);
  }

  /**
   * Returns current server connection details.
   */
  public getAddress(): ServerAddress {
    return {
      port: this.port,
      host: this.host,
      token: this.token,
      httpUrl: `http://${this.host}:${this.port}`,
      wsUrl: `ws://${this.host}:${this.port}/v1/events`,
    };
  }

  /**
   * Stops the server and closes all active connections.
   */
  public async stop(): Promise<void> {
    if (!this.running) return;

    await this.wsManager.close();

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        this.running = false;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public isRunning(): boolean {
    return this.running;
  }
}

/**
 * Factory helper to instantiate and start a runtime server.
 */
export async function createRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServer> {
  const server = new RuntimeServer(options);
  await server.start();
  return server;
}
