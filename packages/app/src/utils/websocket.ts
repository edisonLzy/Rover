export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export interface WebSocketClientOptions {
  url: string;
  token: string;
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
  private manuallyClosed = false;

  constructor(options: WebSocketClientOptions) {
    this.options = {
      initialReconnectDelayMs: 500,
      maxReconnectDelayMs: 8000,
      heartbeatIntervalMs: 3000,
      ...options,
    };
  }

  public connect(): void {
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
            this.options.onLatency?.(latency);
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
                this.options.onLatency?.(latency);
                this.pingTimestamp = null;
              }
            } else {
              this.options.onEvent?.(parsed);
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
        // socket.onclose will be fired by the browser following onerror
      };
    } catch {
      this.setStatus('disconnected');
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    }
  }

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.options.onStatusChange?.(newStatus);
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

    // Initial ping right away
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

  public getStatus(): ConnectionStatus {
    return this.status;
  }
}
