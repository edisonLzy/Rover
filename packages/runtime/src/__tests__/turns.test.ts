import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventStream, type AssistantMessage, type Model, Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  openDatabase,
  runMigrations,
  getRoverTurn,
  getTurnEntries,
  type RoverDatabase,
} from '../storage/index.js';
import { RoverTurnEngine } from '../agent/engine.js';
import { ModelRegistry } from '../models/registry.js';
import type { PromptDocumentV1 } from '../types/prompt.js';
import type { WebSocketManager } from '../transport/websocket.js';

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

describe('Pi Agent Loop 回合引擎与流式响应 (Ticket 005 & ADR-0014)', () => {
  let db: RoverDatabase;
  let modelRegistry: ModelRegistry;
  let testModel: Model<any>;
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = path.join(os.tmpdir(), `rover-turns-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
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
    // Inject mock provider and model
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
      // Ignore cleanup error
    }
  });

  describe('1. 基础问答与流式 Token 响应', () => {
    it('提交合法 PromptDocumentV1 后持久化 user entry 并流式产生 assistant 回复与 turn.end', async () => {
      const emittedEvents: Array<{ type: string; payload: any }> = [];
      const mockWsManager = {
        broadcast: (event: any) => {
          emittedEvents.push(event);
        },
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

      const engine = new RoverTurnEngine({
        db,
        modelRegistry,
        streamFn: mockStreamFn as any,
        wsManager: mockWsManager,
      });

      const promptDoc: PromptDocumentV1 = {
        v: 1,
        parts: [{ type: 'text', text: '你好 Rover' }],
      };

      const result = await engine.executeTurn({
        promptDoc,
        model: testModel,
      });

      // 验证最终状态
      expect(result.status).toBe('completed');
      expect(result.error).toBeNull();

      // 验证 rover_turn 数据库记录
      const turnRecord = getRoverTurn(db.raw, result.turnId);
      expect(turnRecord).not.toBeNull();
      expect(turnRecord?.status).toBe('completed');
      expect(turnRecord?.completedAt).toBeGreaterThan(0);

      // 验证 rover_entry 中有完整的 user 消息和 assistant 消息
      const entries = getTurnEntries(db.raw, result.turnId);
      expect(entries).toHaveLength(2);
      expect(entries[0].data.role).toBe('user');
      expect(entries[0].data.content).toBe('你好 Rover');
      expect(entries[1].data.role).toBe('assistant');
      expect((entries[1].data.content as any)[0].text).toBe('你好！我是 Rover 助手。');

      // 验证 WebSocket 广播了连续的 turn.started, turn.delta, turn.end
      const eventTypes = emittedEvents.map((e) => e.type);
      expect(eventTypes).toContain('turn.started');
      expect(eventTypes).toContain('turn.delta');
      expect(eventTypes).toContain('turn.end');

      const endEvent = emittedEvents.find((e) => e.type === 'turn.end');
      expect(endEvent?.payload.status).toBe('completed');
    });
  });

  describe('2. 受控工具调用与 WAL (先行日志) 顺序落盘', () => {
    it('在工具执行前先持久化 assistant(toolCall)，工具返回后落盘 toolResult，严格遵守 WAL 原则', async () => {
      let toolExecuted = false;
      let assistantEntryPersistedBeforeTool = false;

      const MockToolParams = Type.Object({
        query: Type.String({ description: 'Search query' }),
      });

      const mockTool: AgentTool = {
        name: 'mock_search',
        label: 'Mock Search',
        description: 'Mock search tool',
        parameters: MockToolParams,
        execute: async (toolCallId, params) => {
          // 此时验证 assistant 消息是否已经先行落库 (WAL 原则)
          const currentEntries = getTurnEntries(db.raw, 'turn_wal_test');
          if (currentEntries.some((e) => e.data.role === 'assistant')) {
            assistantEntryPersistedBeforeTool = true;
          }

          toolExecuted = true;
          return {
            content: [{ type: 'text', text: `Result for query: ${(params as any).query}` }],
            details: { toolCallId },
          };
        },
      };

      let round = 0;
      const toolCallMsg = createMockAssistantMessage({
        content: [
          {
            type: 'toolCall',
            id: 'call_1',
            name: 'mock_search',
            arguments: { query: 'test query' },
          },
        ],
      });

      const finalMsg = createMockAssistantMessage({
        content: [{ type: 'text', text: '查询完成，这是最终答复。' }],
      });

      const mockStreamFn = () => {
        round++;
        const targetMsg = round === 1 ? toolCallMsg : finalMsg;
        const stream = new EventStream<any, AssistantMessage>(
          (ev) => ev.type === 'done',
          () => targetMsg
        );
        queueMicrotask(() => {
          stream.push({ type: 'start', partial: targetMsg });
          if (round === 2) {
            stream.push({ type: 'text_delta', delta: '查询完成', partial: targetMsg });
          }
          stream.push({ type: 'done', reason: 'stop' });
          stream.end(targetMsg);
        });
        return stream;
      };

      const engine = new RoverTurnEngine({
        db,
        modelRegistry,
        streamFn: mockStreamFn as any,
        tools: [mockTool],
      });

      const promptDoc: PromptDocumentV1 = {
        v: 1,
        parts: [{ type: 'text', text: '帮我搜索 test query' }],
      };

      const result = await engine.executeTurn({
        turnId: 'turn_wal_test',
        promptDoc,
      });

      expect(result.status).toBe('completed');
      expect(toolExecuted).toBe(true);
      // 验证核心 WAL 约束：工具执行前已经落盘！
      expect(assistantEntryPersistedBeforeTool).toBe(true);

      // 验证数据库完整消息链与 seq 严格递增
      const entries = getTurnEntries(db.raw, 'turn_wal_test');
      expect(entries).toHaveLength(4);
      expect(entries[0].data.role).toBe('user');
      expect(entries[1].data.role).toBe('assistant'); // toolCall 消息
      expect(entries[2].data.role).toBe('toolResult'); // toolResult 消息
      expect(entries[3].data.role).toBe('assistant'); // 最终回答

      // 验证 SQLite seq 顺序递增
      expect(entries[0].seq).toBeLessThan(entries[1].seq);
      expect(entries[1].seq).toBeLessThan(entries[2].seq);
      expect(entries[2].seq).toBeLessThan(entries[3].seq);
    });
  });

  describe('3. 主动取消控制 (Cancellation)', () => {
    it('调用 cancelTurn 能够中断 Agent 运行并将 rover_turn 标记为 cancelled，已写入记录不被删除', async () => {
      let streamCancelled = false;

      const mockStreamFn = (_model: any, _context: any, options: any) => {
        const stream = new EventStream<any, AssistantMessage>(
          (ev) => ev.type === 'done',
          () => ({ role: 'assistant', content: [], model: 'test', stopReason: 'aborted' }) as any
        );

        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            streamCancelled = true;
            const abortedMsg = {
              role: 'assistant',
              content: [],
              model: 'test',
              stopReason: 'aborted',
              timestamp: Date.now(),
            } as any;
            stream.push({ type: 'done', reason: 'aborted' });
            stream.end(abortedMsg);
          });
        }

        return stream;
      };

      const engine = new RoverTurnEngine({
        db,
        modelRegistry,
        streamFn: mockStreamFn as any,
      });

      const promptDoc: PromptDocumentV1 = {
        v: 1,
        parts: [{ type: 'text', text: '取消测试' }],
      };

      // 异步触发 turn
      const turnPromise = engine.executeTurn({
        turnId: 'turn_cancel_test',
        promptDoc,
      });

      // 短暂延时后调用 cancel
      await new Promise((r) => setTimeout(r, 50));
      expect(engine.isTurnRunning('turn_cancel_test')).toBe(true);

      const cancelSuccess = engine.cancelTurn('turn_cancel_test');
      expect(cancelSuccess).toBe(true);

      const result = await turnPromise;
      expect(result.status).toBe('cancelled');
      expect(streamCancelled).toBe(true);

      // 验证 rover_turn 状态为 cancelled
      const turnRecord = getRoverTurn(db.raw, 'turn_cancel_test');
      expect(turnRecord?.status).toBe('cancelled');

      // 验证已落库的 user 消息依然客观存在，未被物理删除
      const entries = getTurnEntries(db.raw, 'turn_cancel_test');
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].data.role).toBe('user');
    });
  });

  describe('4. 异常容错性 (No Crash)', () => {
    it('当未配置激活模型或提供商不存在时，返回结构化错误码，状态置为 failed 且进程不崩溃', async () => {
      // 构造未配置模型的空注册中心
      const emptyConfigPath = path.join(os.tmpdir(), `rover-turns-empty-${Date.now()}.json`);
      const emptyRegistry = new ModelRegistry(emptyConfigPath);
      emptyRegistry.saveConfig({ providers: {} });

      const engine = new RoverTurnEngine({
        db,
        modelRegistry: emptyRegistry,
      });

      const promptDoc: PromptDocumentV1 = {
        v: 1,
        parts: [{ type: 'text', text: '没有模型测试' }],
      };

      const result = await engine.executeTurn({
        turnId: 'turn_fail_test',
        promptDoc,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('No active model configured');

      const turn = getRoverTurn(db.raw, 'turn_fail_test');
      expect(turn?.status).toBe('failed');
      expect(turn?.error).toContain('No active model configured');
    });
  });
});
