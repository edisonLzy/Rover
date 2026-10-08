import { describe, it, expect, vi } from 'vitest';
import { turnsRouter, historyRouter } from '../router.js';
import { AgentService } from '../service.js';
import type { AgentRuntime } from '../runtime/index.js';

describe('AgentService & Router DI Isolation Tests', () => {
  it('correctly maps turnsRouter procedures to ctx.container.agent', async () => {
    const mockAgentService = {
      startTurn: vi.fn().mockResolvedValue({ turnId: 'turn-123', status: 'running' }),
      cancelTurn: vi.fn().mockReturnValue({ success: true, turnId: 'turn-123' }),
      steer: vi.fn().mockReturnValue({ success: true }),
      clearAllQueues: vi.fn().mockReturnValue({ success: true }),
      getTurn: vi.fn().mockReturnValue({ turn: null, entries: [] }),
      getFeed: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({
        totalEntries: 0,
        totalMessages: 0,
        totalCompactions: 0,
        totalTurns: 0,
        latestSeq: 0,
      }),
      getEffectiveHistory: vi
        .fn()
        .mockReturnValue({ compaction: null, messages: [], latestSeq: 0 }),
      listTurns: vi.fn().mockReturnValue([]),
    } as unknown as AgentService;

    const caller = turnsRouter.createCaller({
      req: {} as any,
      res: {} as any,
      token: 'test',
      isAuthenticated: true,
      container: { agentService: mockAgentService } as any,
    });

    const startRes = await caller.start({
      promptDoc: { v: 1, parts: [{ type: 'text', text: 'Hello' }] },
      turnId: 'turn-123',
    });
    expect(startRes).toEqual({ turnId: 'turn-123', status: 'running' });
    expect(mockAgentService.startTurn).toHaveBeenCalledWith({
      promptDoc: { v: 1, parts: [{ type: 'text', text: 'Hello' }] },
      turnId: 'turn-123',
    });

    const cancelRes = await caller.cancel({ turnId: 'turn-123' });
    expect(cancelRes).toEqual({ success: true, turnId: 'turn-123' });
    expect(mockAgentService.cancelTurn).toHaveBeenCalledWith('turn-123');

    const steerRes = await caller.steer({ content: 'Steer info' });
    expect(steerRes).toEqual({ success: true });
    expect(mockAgentService.steer).toHaveBeenCalledWith('Steer info');

    const clearRes = await caller.clearAllQueues();
    expect(clearRes).toEqual({ success: true });
    expect(mockAgentService.clearAllQueues).toHaveBeenCalled();

    const getRes = await caller.get({ turnId: 'turn-123' });
    expect(getRes).toEqual({ turn: null, entries: [] });
    expect(mockAgentService.getTurn).toHaveBeenCalledWith('turn-123');
  });

  it('correctly maps historyRouter procedures to ctx.container.agent', async () => {
    const mockAgentService = {
      startTurn: vi.fn(),
      cancelTurn: vi.fn(),
      steer: vi.fn(),
      clearAllQueues: vi.fn(),
      getTurn: vi.fn().mockReturnValue({ turn: null, entries: [] }),
      getFeed: vi.fn().mockReturnValue([{ id: 'entry-1', seq: 1 } as any]),
      getStats: vi.fn().mockReturnValue({
        totalEntries: 1,
        totalMessages: 1,
        totalCompactions: 0,
        totalTurns: 1,
        latestSeq: 1,
      }),
      getEffectiveHistory: vi
        .fn()
        .mockReturnValue({ compaction: null, messages: [], latestSeq: 1 }),
      listTurns: vi.fn().mockReturnValue([]),
    } as unknown as AgentService;

    const caller = historyRouter.createCaller({
      req: {} as any,
      res: {} as any,
      token: 'test',
      isAuthenticated: true,
      container: { agentService: mockAgentService } as any,
    });

    const feedRes = await caller.getFeed({ limit: 10 });
    expect(feedRes).toHaveLength(1);
    expect(mockAgentService.getFeed).toHaveBeenCalledWith({ limit: 10, offset: 0, order: 'asc' });

    const statsRes = await caller.getStats();
    expect(statsRes.totalEntries).toBe(1);
    expect(mockAgentService.getStats).toHaveBeenCalled();

    const effectiveRes = await caller.getEffective();
    expect(effectiveRes.latestSeq).toBe(1);
    expect(mockAgentService.getEffectiveHistory).toHaveBeenCalled();

    const listTurnsRes = await caller.listTurns();
    expect(listTurnsRes).toEqual([]);
    expect(mockAgentService.listTurns).toHaveBeenCalled();

    const getTurnRes = await caller.getTurn({ turnId: 'turn-1' });
    expect(getTurnRes).toEqual({ turn: null, entries: [] });
    expect(mockAgentService.getTurn).toHaveBeenCalledWith('turn-1');
  });

  it('AgentService throws when no active model is resolved on startTurn', async () => {
    const mockRuntime: Partial<AgentRuntime> = {
      isTurnRunning: () => false,
    };
    const mockModelService = {
      getRegistry: () => ({
        resolveActiveModel: () => undefined,
      }),
    };

    const service = new AgentService({
      modelService: mockModelService as any,
      runtime: mockRuntime as AgentRuntime,
      db: {} as any,
    });

    await expect(
      service.startTurn({
        promptDoc: { v: 1, parts: [{ type: 'text', text: 'hi' }] },
      })
    ).rejects.toThrow(/No active model configured/);
  });
});
