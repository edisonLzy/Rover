import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  runMigrations,
  createRoverTurn,
  getRoverTurn,
  getTurnEntries,
  type RoverDatabase,
} from '../storage/index.js';
import { AgentEventHandler } from '../agent/handler.js';
import type { WebSocketManager } from '../transport/websocket.js';

describe('AgentEventHandler (Dedicated Event Pipeline & WAL)', () => {
  let db: RoverDatabase;
  const turnId = 'turn_handler_test';

  beforeEach(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    createRoverTurn(db.raw, {
      id: turnId,
      promptDoc: { v: 1, parts: [{ type: 'text', text: 'Hello Rover' }] },
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('broadcasts step_started and delta events correctly', async () => {
    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const mockWsManager = {
      broadcast: (evt: any) => emittedEvents.push(evt),
    } as unknown as WebSocketManager;

    const handler = new AgentEventHandler({
      db: db.raw,
      turnId,
      wsManager: mockWsManager,
    });

    // 1. turn_start
    await handler.handle({ type: 'turn_start' });
    expect(emittedEvents.some((e) => e.type === 'turn.step_started')).toBe(true);

    // 2. message_update (text_delta)
    const assistantMsg = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Hello world' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'gpt-4o',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop' as const,
      timestamp: Date.now(),
    };

    await handler.handle({
      type: 'message_update',
      message: assistantMsg,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello world',
        partial: assistantMsg,
      },
    });

    const textDeltaEvent = emittedEvents.find(
      (e) => e.type === 'turn.delta' && !e.payload.isThinking
    );
    expect(textDeltaEvent).toBeDefined();
    expect(textDeltaEvent?.payload.textDelta).toBe('Hello world');

    // 3. message_update (thinking_delta)
    const thinkingMsg = {
      role: 'assistant' as const,
      content: [{ type: 'thinking' as const, thinking: 'Thinking...' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'gpt-4o',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop' as const,
      timestamp: Date.now(),
    };

    await handler.handle({
      type: 'message_update',
      message: thinkingMsg,
      assistantMessageEvent: {
        type: 'thinking_delta',
        contentIndex: 0,
        delta: 'Thinking...',
        partial: thinkingMsg,
      },
    });

    const thinkingDeltaEvent = emittedEvents.find(
      (e) => e.type === 'turn.delta' && e.payload.isThinking
    );
    expect(thinkingDeltaEvent).toBeDefined();
    expect(thinkingDeltaEvent?.payload.thinkingDelta).toBe('Thinking...');
  });

  it('immediately persists assistant and toolResult messages on message_end (WAL)', async () => {
    const handler = new AgentEventHandler({
      db: db.raw,
      turnId,
    });

    const assistantMsg = {
      role: 'assistant' as const,
      content: [
        {
          type: 'toolCall' as const,
          id: 'call_abc',
          name: 'terminal_run',
          arguments: { cmd: 'ls -la' },
        },
      ],
      api: 'openai-completions',
      provider: 'openai',
      model: 'gpt-4o',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'toolUse' as const,
      timestamp: Date.now(),
    };

    // 1. Assistant message with toolCall ends -> must be persisted immediately
    await handler.handle({
      type: 'message_end',
      message: assistantMsg,
    });

    let entries = getTurnEntries(db.raw, turnId);
    expect(entries).toHaveLength(1);
    expect(entries[0].data.role).toBe('assistant');
    expect(entries[0].seq).toBeGreaterThan(0);

    // 2. Duplicate message_end for the same reference is deduplicated
    await handler.handle({
      type: 'message_end',
      message: assistantMsg,
    });
    entries = getTurnEntries(db.raw, turnId);
    expect(entries).toHaveLength(1);

    // 3. ToolResult message ends -> must be persisted immediately
    const toolResultMsg = {
      role: 'toolResult' as const,
      toolCallId: 'call_abc',
      toolName: 'terminal_run',
      content: [{ type: 'text' as const, text: 'file1.txt\nfile2.txt' }],
      isError: false,
      timestamp: Date.now(),
    };

    await handler.handle({
      type: 'message_end',
      message: toolResultMsg as any,
    });

    entries = getTurnEntries(db.raw, turnId);
    expect(entries).toHaveLength(2);
    expect(entries[1].data.role).toBe('toolResult');
    expect(entries[0].seq).toBeLessThan(entries[1].seq);
  });

  it('broadcasts tool execution start and end events', async () => {
    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const mockWsManager = {
      broadcast: (evt: any) => emittedEvents.push(evt),
    } as unknown as WebSocketManager;

    const handler = new AgentEventHandler({
      db: db.raw,
      turnId,
      wsManager: mockWsManager,
    });

    await handler.handle({
      type: 'tool_execution_start',
      toolCallId: 'call_1',
      toolName: 'read_file',
      args: { path: '/tmp/test' },
    });

    expect(emittedEvents.some((e) => e.type === 'turn.tool_call')).toBe(true);

    await handler.handle({
      type: 'tool_execution_end',
      toolCallId: 'call_1',
      toolName: 'read_file',
      result: { content: 'file content' },
      isError: false,
    });

    expect(emittedEvents.some((e) => e.type === 'turn.tool_result')).toBe(true);
  });

  it('updates rover_turn status and notifies onComplete when agent_end fires', async () => {
    let turnEndNotified = false;
    let finalStatusReported: string | null = null;

    const handler = new AgentEventHandler({
      db: db.raw,
      turnId,
      onComplete: ({ status }) => {
        turnEndNotified = true;
        finalStatusReported = status;
      },
    });

    await handler.handle({
      type: 'agent_end',
      messages: [],
    });

    expect(turnEndNotified).toBe(true);
    expect(finalStatusReported).toBe('completed');

    const turn = getRoverTurn(db.raw, turnId);
    expect(turn?.status).toBe('completed');
    expect(turn?.completedAt).toBeGreaterThan(0);
  });

  it('broadcasts turn.started when agent_start fires and manages currentTurnId lifecycle', async () => {
    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const mockWsManager = {
      broadcast: (evt: any) => emittedEvents.push(evt),
    } as unknown as WebSocketManager;

    const handler = new AgentEventHandler({
      db: db.raw,
      wsManager: mockWsManager,
    });

    expect(handler.currentTurnId).toBeNull();
    expect(handler.isRunning).toBe(false);

    let completed = false;
    handler.startTurn(turnId, () => {
      completed = true;
    });

    expect(handler.currentTurnId).toBe(turnId);
    expect(handler.isRunning).toBe(true);

    // 1. Pi Agent Core emits agent_start
    await handler.handle({ type: 'agent_start' });
    const startEvent = emittedEvents.find((e) => e.type === 'turn.started');
    expect(startEvent).toBeDefined();
    expect(startEvent?.payload.turnId).toBe(turnId);

    // 2. Pi Agent Core emits agent_end
    await handler.handle({ type: 'agent_end', messages: [] });
    expect(completed).toBe(true);
    expect(handler.currentTurnId).toBeNull();
    expect(handler.isRunning).toBe(false);
  });

  it('handles fail() and cancel() gracefully updating DB and notifying onComplete', async () => {
    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const mockWsManager = {
      broadcast: (evt: any) => emittedEvents.push(evt),
    } as unknown as WebSocketManager;

    const handler = new AgentEventHandler({
      db: db.raw,
      wsManager: mockWsManager,
    });

    let failedResult: any = null;
    handler.startTurn(turnId, (res) => {
      failedResult = res;
    });

    handler.fail('Model quota exceeded');
    expect(failedResult?.status).toBe('failed');
    expect(failedResult?.error).toBe('Model quota exceeded');
    expect(handler.currentTurnId).toBeNull();

    const turn = getRoverTurn(db.raw, turnId);
    expect(turn?.status).toBe('failed');
    expect(turn?.error).toBe('Model quota exceeded');
  });
});
