import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import {
  AgentRuntime,
  TurnPersistenceCallbacks,
  WebSocketBroadcastCallbacks,
} from '../runtime/index.js';
import {
  openDatabase,
  runMigrations,
  type RoverDatabase,
} from '../../../infrastructure/database/index.js';
import { getRoverTurn, getTurnEntries } from '../repository.js';
import { ModelRegistry } from '../../models/index.js';
import type { PromptDocumentV1 } from '../../../types/prompt.js';
import type { WebSocketManager } from '../../../transport/websocket.js';

function createMockAssistantMessage(partial: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...partial,
  } as AssistantMessage;
}

describe('Turn 消息先行持久化与 WebSocket 广播 Callbacks (Ticket 014b & ADR-0019)', () => {
  let db: RoverDatabase;
  let modelRegistry: ModelRegistry;
  let testModel: Model<any>;
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = path.join(
      os.tmpdir(),
      `rover-callbacks-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    testModel = {
      id: 'test-model',
      name: 'Test Model',
      api: 'openai-completions',
      provider: 'test-provider',
      baseUrl: 'https://api.test.com',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    modelRegistry = new ModelRegistry(tempConfigPath);
    modelRegistry.saveConfig({
      active: { provider: 'test-provider', model: 'test-model' },
      providers: {
        'test-provider': {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-key',
          api: 'openai-completions',
          models: [
            {
              id: 'test-model',
              name: 'Test Model',
              contextWindow: 128000,
              maxTokens: 4096,
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0 },
            },
          ],
        },
      },
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    try {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    } catch {
      // Ignore
    }
  });

  it('1. 验证常规 Prompt：WAL 先行落盘、流式消息追加、终态决算与 WebSocket 广播完整闭环', async () => {
    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const mockWsManager = {
      broadcast: (evt: any) => emittedEvents.push(evt),
    } as unknown as WebSocketManager;

    const finalAssistantMsg = createMockAssistantMessage({
      content: [{ type: 'text', text: '你好！我是 Rover 助手。' }],
    });

    const mockStreamFn = () => {
      const stream = new EventStream<any, AssistantMessage>(
        (ev) => ev.type === 'done',
        () => finalAssistantMsg
      );
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: finalAssistantMsg });
        stream.push({
          type: 'text_delta',
          delta: '你好！我是 Rover 助手。',
          partial: finalAssistantMsg,
        });
        stream.push({ type: 'done', reason: 'stop' });
        stream.end(finalAssistantMsg);
      });
      return stream;
    };

    const runtime = new AgentRuntime({
      modelRegistry,
      streamFn: mockStreamFn as any,
    });

    // 挂载两个核心 Callbacks
    runtime.addEventCallbacks(new TurnPersistenceCallbacks(db));
    runtime.addEventCallbacks(
      new WebSocketBroadcastCallbacks({ wsManager: mockWsManager, db: db.raw })
    );

    const promptDoc: PromptDocumentV1 = {
      v: 1,
      parts: [{ type: 'text', text: '你好 Rover' }],
    };

    const turnId = await runtime.prompt({
      promptDoc,
      model: testModel,
    });

    await runtime.waitForIdle();

    // 1. 验证 rover_turn 数据库记录
    const turnRecord = getRoverTurn(db.raw, turnId);
    expect(turnRecord).not.toBeNull();
    expect(turnRecord?.status).toBe('completed');
    expect(turnRecord?.completedAt).toBeGreaterThan(0);
    expect(turnRecord?.error).toBeNull();

    // 2. 验证 rover_entry 消息落盘 (ADR-0014 WAL 原则)
    const entries = getTurnEntries(db.raw, turnId);
    expect(entries.length).toBe(2);

    // 第一条：user 消息 (由 onTurnStart 先行落盘)
    expect(entries[0].type).toBe('message');
    expect(entries[0].data.role).toBe('user');
    expect(entries[0].data.content).toBe('你好 Rover');

    // 第二条：assistant 消息 (由 onMessageEnd 在生成结束时即刻追加)
    expect(entries[1].type).toBe('message');
    expect(entries[1].data.role).toBe('assistant');
    expect((entries[1].data.content as any)[0].text).toBe('你好！我是 Rover 助手。');

    // 3. 验证 WebSocket 广播事件
    expect(
      emittedEvents.some((e) => e.type === 'turn.started' && e.payload.turnId === turnId)
    ).toBe(true);
    expect(
      emittedEvents.some((e) => e.type === 'turn.step_started' && e.payload.turnId === turnId)
    ).toBe(true);
    expect(
      emittedEvents.some(
        (e) => e.type === 'turn.delta' && e.payload.textDelta === '你好！我是 Rover 助手。'
      )
    ).toBe(true);
    expect(
      emittedEvents.some((e) => e.type === 'turn.end' && e.payload.status === 'completed')
    ).toBe(true);

    // 4. 验证事件中携带了 runtime_event 表生成的递增序号 eventSeq
    const startEvent = emittedEvents.find((e) => e.type === 'turn.started');
    expect(startEvent?.payload.eventSeq).toBeDefined();
    expect(typeof startEvent?.payload.eventSeq).toBe('number');
  });

  it('016 preserves structured references in a new turn', async () => {
    const events: Array<{ type: string; payload: any }> = [];
    const message = createMockAssistantMessage({ content: [{ type: 'text', text: 'done' }] });
    const runtime = new AgentRuntime({
      modelRegistry,
      streamFn: (() => {
        const stream = new EventStream<any, AssistantMessage>(
          (event) => event.type === 'done',
          () => message
        );
        queueMicrotask(() => {
          stream.push({ type: 'done', reason: 'stop', message });
          stream.end(message);
        });
        return stream;
      }) as any,
    });
    runtime.addEventCallbacks(new TurnPersistenceCallbacks(db));
    runtime.addEventCallbacks(
      new WebSocketBroadcastCallbacks({
        db: db.raw,
        wsManager: { broadcast: (event: any) => events.push(event) } as unknown as WebSocketManager,
      })
    );
    const promptDoc: PromptDocumentV1 = {
      v: 1,
      parts: [
        { type: 'reference', kind: 'agent', id: 'codex', label: 'Codex' },
        { type: 'text', text: '检查' },
        { type: 'reference', kind: 'inbox', id: 'issue-1', label: '告警' },
      ],
    };
    const turnId = await runtime.prompt({
      promptDoc,
    });
    await runtime.waitForIdle();
    expect(getRoverTurn(db.raw, turnId)?.promptDoc).toEqual(promptDoc);
    expect(getRoverTurn(db.raw, turnId)?.status).toBe('completed');
    const firstEntry = getTurnEntries(db.raw, turnId)[0];
    expect(firstEntry.data.role).toBe('user');
    expect(typeof firstEntry.data.timestamp).toBe('number');
    expect(
      events.some((event) => event.type === 'turn.started' && event.payload.turnId === turnId)
    ).toBe(true);
  });

  it('2. 验证模型调用异常时，数据库与广播均闭环标记为 failed', async () => {
    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const mockWsManager = {
      broadcast: (evt: any) => emittedEvents.push(evt),
    } as unknown as WebSocketManager;

    const mockStreamFn = () => {
      throw new Error('API Rate Limit Exceeded');
    };

    const runtime = new AgentRuntime({
      modelRegistry,
      streamFn: mockStreamFn as any,
    });

    runtime.addEventCallbacks(new TurnPersistenceCallbacks(db));
    runtime.addEventCallbacks(
      new WebSocketBroadcastCallbacks({ wsManager: mockWsManager, db: db.raw })
    );

    const promptDoc: PromptDocumentV1 = {
      v: 1,
      parts: [{ type: 'text', text: '触发限流' }],
    };

    let thrownError: Error | null = null;
    let turnId = '';
    runtime.addEventCallbacks({
      onTurnStart: (ctx) => {
        turnId = ctx.turnId;
      },
    });

    try {
      await runtime.prompt({
        promptDoc,
        model: testModel,
      });
      await runtime.waitForIdle();
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).not.toBeNull();

    // 验证数据库状态标记为 failed
    expect(turnId).not.toBe('');
    const turnRecord = getRoverTurn(db.raw, turnId);
    expect(turnRecord?.status).toBe('failed');
    expect(turnRecord?.error).toContain('API Rate Limit Exceeded');
  });

  it('3. 验证用户主动中断 (abortPrompt) 时，数据库状态更新为 cancelled 且广播 turn.end', async () => {
    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const mockWsManager = {
      broadcast: (evt: any) => emittedEvents.push(evt),
    } as unknown as WebSocketManager;

    const mockStreamFn = (_model: any, _context: any, options?: any) => {
      const stream = new EventStream<any, AssistantMessage>(
        (ev) => ev.type === 'done',
        () => createMockAssistantMessage({})
      );
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          stream.push({ type: 'done', reason: 'aborted' });
          stream.end(createMockAssistantMessage({ stopReason: 'aborted' }));
        });
      }
      return stream;
    };

    const runtime = new AgentRuntime({
      modelRegistry,
      streamFn: mockStreamFn as any,
    });

    runtime.addEventCallbacks(new TurnPersistenceCallbacks(db));
    runtime.addEventCallbacks(
      new WebSocketBroadcastCallbacks({ wsManager: mockWsManager, db: db.raw })
    );

    let turnId = '';
    runtime.addEventCallbacks({
      onTurnStart: (ctx) => {
        turnId = ctx.turnId;
      },
    });

    const promptDoc: PromptDocumentV1 = {
      v: 1,
      parts: [{ type: 'text', text: '需要被取消的回合' }],
    };

    const turnPromise = runtime.prompt({
      promptDoc,
      model: testModel,
    });

    // 立即执行中断
    runtime.abortPrompt();

    try {
      await turnPromise;
    } catch {
      // Ignore abort error
    }
    await runtime.waitForIdle();

    // 验证数据库状态为 cancelled
    const turnRecord = getRoverTurn(db.raw, turnId);
    expect(turnRecord?.status).toBe('cancelled');

    // 验证 WebSocket 广播了 cancelled 的 turn.end
    const endEvent = emittedEvents.find((e) => e.type === 'turn.end');
    expect(endEvent).toBeDefined();
    expect(endEvent?.payload.status).toBe('cancelled');
  });
});
