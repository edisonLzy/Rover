import { describe, it, expect } from 'vitest';
import { createContainer } from '../container.js';
import { WebSocketManager } from '../transport/websocket.js';

describe('Container Composition Root (ADR-0020)', () => {
  const wsManager = new WebSocketManager({ expectedToken: 'test-token' });

  it('creates an immutable container holding db, models, and skills services', () => {
    const container = createContainer({ wsManager });

    expect(container.db).toBeDefined();
    expect(container.modelService).toBeDefined();
    expect(container.skillService).toBeDefined();
    expect(container.taskService).toBeDefined();
    expect(container.agentService).toBeDefined();
    expect(container.inboxService).toBeDefined();
    expect(Object.isFrozen(container)).toBe(true);
  });

  it('creates fresh independent containers across calls', () => {
    const c1 = createContainer({ wsManager });
    const c2 = createContainer({ wsManager });

    expect(c1).not.toBe(c2);
    expect(c1.agentService).not.toBe(c2.agentService);
    expect(c1.inboxService).not.toBe(c2.inboxService);
  });
});
