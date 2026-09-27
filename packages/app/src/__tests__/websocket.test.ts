import { describe, expect, it } from 'vitest';
import { RoverWebSocketClient, type ConnectionStatus } from '../utils/websocket';

describe('RoverWebSocketClient Reconnect & State Machine (M0-4)', () => {
  it('starts in idle state', () => {
    const client = new RoverWebSocketClient({
      url: 'ws://127.0.0.1:9999/v1/events',
      token: 'test-token',
    });

    expect(client.getStatus()).toBe('idle');
  });

  it('transitions to idle on disconnect', () => {
    const statuses: ConnectionStatus[] = [];
    const client = new RoverWebSocketClient({
      url: 'ws://127.0.0.1:9999/v1/events',
      token: 'test-token',
      onStatusChange: (s) => statuses.push(s),
    });

    client.disconnect();
    expect(client.getStatus()).toBe('idle');
  });
});
