import { describe, expect, it, vi } from 'vitest';
import type { TurnDeltaPayload, TaskChangedPayload } from '@rover/runtime/expose';
import { RoverWebSocketClient, type ConnectionStatus } from '../context/RuntimeContext';

describe('RoverWebSocketClient Reconnect & State Machine (M0-4)', () => {
  it('starts in idle state', () => {
    const client = new RoverWebSocketClient({
      url: 'ws://127.0.0.1:9999/v1/events',
      token: 'test-token',
    });

    expect(client.getStatus()).toBe('idle');
    expect(client.getState()).toBe('idle');
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

  it('notifies state subscribers when status changes', () => {
    const client = new RoverWebSocketClient();
    const subscriber = vi.fn();
    const unsubscribe = client.subscribeState(subscriber);

    // Call private setStatus via any
    (client as any).setStatus('connecting');
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(client.getState()).toBe('connecting');

    unsubscribe();
    (client as any).setStatus('connected');
    expect(subscriber).toHaveBeenCalledTimes(1);
  });
});

describe('RoverWebSocketClient Multi-subscriber Event Bus (ADR-0017)', () => {
  it('dispatches typed events to registered handlers', () => {
    const client = new RoverWebSocketClient();

    const turnDeltaEvents: TurnDeltaPayload[] = [];
    const taskChangedEvents: TaskChangedPayload[] = [];

    const unregister = client.registerEventHandler({
      'turn.delta': (payload) => {
        turnDeltaEvents.push(payload);
      },
      'task.changed': (payload) => {
        taskChangedEvents.push(payload);
      },
    });

    // Simulate receiving WS message envelopes via private dispatchEvent
    (client as any).dispatchEvent({
      type: 'turn.delta',
      payload: { turnId: 'turn-1', textDelta: 'Hello', isThinking: false },
    });

    (client as any).dispatchEvent({
      type: 'task.changed',
      payload: {
        taskId: 'task-1',
        goal: 'Fix bug',
        agent: 'claude',
        status: 'needs_intervention',
        updatedAt: 123456,
      },
    });

    // Unrelated event
    (client as any).dispatchEvent({
      type: 'turn.end',
      payload: { turnId: 'turn-1', status: 'completed' },
    });

    expect(turnDeltaEvents).toHaveLength(1);
    expect(turnDeltaEvents[0].turnId).toBe('turn-1');
    expect(turnDeltaEvents[0].textDelta).toBe('Hello');

    expect(taskChangedEvents).toHaveLength(1);
    expect(taskChangedEvents[0].taskId).toBe('task-1');
    expect(taskChangedEvents[0].status).toBe('needs_intervention');

    // Unregister and verify no more events received
    unregister();

    (client as any).dispatchEvent({
      type: 'turn.delta',
      payload: { turnId: 'turn-2', textDelta: 'World' },
    });

    expect(turnDeltaEvents).toHaveLength(1);
  });

  it('isolates listener errors so other listeners still execute', () => {
    const client = new RoverWebSocketClient();
    const secondListener = vi.fn();

    client.registerEventHandler({
      'turn.delta': () => {
        throw new Error('Exploding listener');
      },
    });

    client.registerEventHandler({
      'turn.delta': secondListener,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      (client as any).dispatchEvent({
        type: 'turn.delta',
        payload: { turnId: 'turn-error', textDelta: 'Test' },
      });
    }).not.toThrow();

    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error in listener for "turn.delta":'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
