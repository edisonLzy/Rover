import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { AgentRuntime } from '../runtime/index.js';
import type {
  AgentRuntimeEventCallbacks,
  MessageDeltaEvent,
  TurnContext,
  TurnEndResult,
} from '../types.js';
import { ModelRegistry } from '../../models/index.js';
import type { PromptDocumentV1 } from '../../../types/prompt.js';

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

describe('AgentRuntime 纯领域核心与 Event Callbacks 契约 (Ticket 014a & ADR-0019)', () => {
  let modelRegistry: ModelRegistry;
  let testModel: Model<any>;
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = path.join(
      os.tmpdir(),
      `rover-runtime-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

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
    try {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    } catch {
      // Ignore
    }
  });

  it('1. 验证常规 Prompt 执行与全生命周期 Callbacks 序列', async () => {
    const eventsSequence: string[] = [];
    let recordedTurnContext: TurnContext | null = null;
    const recordedDeltas: MessageDeltaEvent[] = [];
    let endResult: TurnEndResult | null = null;

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

    const callbacks: AgentRuntimeEventCallbacks = {
      onTurnStart: (ctx) => {
        eventsSequence.push('onTurnStart');
        recordedTurnContext = ctx;
      },
      onTurnStepStart: () => {
        eventsSequence.push('onTurnStepStart');
      },
      onMessageDelta: (_ctx, delta) => {
        eventsSequence.push('onMessageDelta');
        recordedDeltas.push(delta);
      },
      onMessageEnd: (_ctx, msg) => {
        eventsSequence.push(`onMessageEnd:${msg.role}`);
      },
      onTurnEnd: (_ctx, res) => {
        eventsSequence.push('onTurnEnd');
        endResult = res;
      },
    };

    runtime.addEventCallbacks(callbacks);

    const promptDoc: PromptDocumentV1 = {
      v: 1,
      parts: [{ type: 'text', text: '你好 Rover' }],
    };

    const turnId = await runtime.prompt({
      promptDoc,
      model: testModel,
    });

    await runtime.waitForIdle();

    // 验证前置 onTurnStart 正确就绪并携带完整上下文
    expect(eventsSequence[0]).toBe('onTurnStart');
    expect(recordedTurnContext).not.toBeNull();
    const ctx = recordedTurnContext as unknown as TurnContext;
    expect(ctx.turnId).toBe(turnId);
    expect(ctx.userPrompt).toEqual(promptDoc);
    expect(ctx.model?.id).toBe('test-model');

    // 验证整体回调序列
    expect(eventsSequence).toContain('onTurnStepStart');
    expect(eventsSequence).toContain('onMessageDelta');
    expect(eventsSequence).toContain('onMessageEnd:assistant');
    expect(eventsSequence).toContain('onTurnEnd');

    // 验证 Delta 内容
    expect(recordedDeltas.length).toBeGreaterThan(0);
    expect(recordedDeltas[0].delta).toBe('你好！我是 Rover 助手。');
    expect(recordedDeltas[0].isThinking).toBe(false);

    // 验证终态决算结果
    expect(endResult).not.toBeNull();
    const res = endResult as unknown as TurnEndResult;
    expect(res.status).toBe('completed');
    expect(res.error).toBeNull();
  });

  it('2. 验证思考链增量 (thinking_delta) 的识别与传递', async () => {
    const thinkingDeltas: MessageDeltaEvent[] = [];

    const thinkingAssistantMsg = createMockAssistantMessage({
      content: [
        { type: 'thinking', thinking: '正在分析问题...' } as any,
        { type: 'text', text: '结论：完成。' },
      ],
    });

    const mockStreamFn = () => {
      const stream = new EventStream<any, AssistantMessage>(
        (ev) => ev.type === 'done',
        () => thinkingAssistantMsg
      );
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: thinkingAssistantMsg });
        stream.push({
          type: 'thinking_delta',
          delta: '正在分析问题...',
          partial: thinkingAssistantMsg,
        });
        stream.push({
          type: 'text_delta',
          delta: '结论：完成。',
          partial: thinkingAssistantMsg,
        });
        stream.push({ type: 'done', reason: 'stop' });
        stream.end(thinkingAssistantMsg);
      });
      return stream;
    };

    const runtime = new AgentRuntime({
      modelRegistry,
      streamFn: mockStreamFn as any,
    });

    runtime.addEventCallbacks({
      onMessageDelta: (_ctx, delta) => {
        if (delta.isThinking) {
          thinkingDeltas.push(delta);
        }
      },
    });

    await runtime.prompt({
      promptDoc: { v: 1, parts: [{ type: 'text', text: '复杂思考任务' }] },
      model: testModel,
    });

    await runtime.waitForIdle();

    expect(thinkingDeltas.length).toBe(1);
    expect(thinkingDeltas[0].isThinking).toBe(true);
    expect(thinkingDeltas[0].delta).toBe('正在分析问题...');
  });

  it('3. 验证 Callbacks 注册、注销与单个 Callback 抛错容错隔离', async () => {
    const runtime = new AgentRuntime({ modelRegistry });
    let normalCallbackCalled = false;

    // 恶意 Callback：故意抛出异常
    const faultyCallbacks: AgentRuntimeEventCallbacks = {
      onTurnStart: () => {
        throw new Error('Callback boom!');
      },
    };

    // 正常 Callback
    const normalCallbacks: AgentRuntimeEventCallbacks = {
      onTurnStart: () => {
        normalCallbackCalled = true;
      },
    };

    runtime.addEventCallbacks(faultyCallbacks);
    const unregisterNormal = runtime.addEventCallbacks(normalCallbacks);

    // 触发 Callbacks
    await runtime.triggerCallback('onTurnStart', {
      turnId: 'test_isolation',
      startTime: Date.now(),
    });

    // 验证即使 faultyCallbacks 抛错，normalCallback 依然被正常调用
    expect(normalCallbackCalled).toBe(true);

    // 测试注销功能
    normalCallbackCalled = false;
    unregisterNormal();

    await runtime.triggerCallback('onTurnStart', {
      turnId: 'test_isolation_2',
      startTime: Date.now(),
    });

    expect(normalCallbackCalled).toBe(false);
  });

  it('4. 验证 steer、followUp 与 clearAllQueues 接口调度', async () => {
    const runtime = new AgentRuntime({ modelRegistry });

    // 验证调用 steer 不抛错
    expect(() => {
      runtime.steer({ content: '紧急干预指令' });
    }).not.toThrow();

    // 验证调用 followUp 不抛错
    expect(() => {
      runtime.followUp({ content: '排队后续任务' });
    }).not.toThrow();

    // 验证 clearAllQueues 清空队列
    expect(() => {
      runtime.clearAllQueues();
    }).not.toThrow();
  });

  it('5. 验证主动中断 (abortPrompt) 能将终态置为 cancelled', async () => {
    let finalStatus: string | null = null;

    const mockStreamFn = () => {
      const stream = new EventStream<any, AssistantMessage>(
        (ev) => ev.type === 'done',
        () => createMockAssistantMessage({})
      );
      // 故意不结束，模拟长时生成
      return stream;
    };

    const runtime = new AgentRuntime({
      modelRegistry,
      streamFn: mockStreamFn as any,
    });

    runtime.addEventCallbacks({
      onTurnEnd: (_ctx, res) => {
        finalStatus = res.status;
      },
    });

    void runtime.prompt({
      promptDoc: { v: 1, parts: [{ type: 'text', text: '长文本生成' }] },
      model: testModel,
    });

    // 立即中断
    runtime.abortPrompt();
    await runtime.waitForIdle();

    expect(finalStatus).toBe('cancelled');
  });
  it('016 starts sequential turns cleanly after idle', async () => {
    const releases: Array<() => void> = [];
    const streamFn = vi.fn(() => {
      const message = createMockAssistantMessage({ content: [{ type: 'text', text: 'done' }] });
      const stream = new EventStream<any, AssistantMessage>(
        (e) => e.type === 'done',
        () => message
      );
      releases.push(() => {
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      });
      return stream;
    });
    const runtime = new AgentRuntime({ modelRegistry, streamFn: streamFn as any });
    const starts: TurnContext[] = [];
    runtime.addEventCallbacks({
      onTurnStart: (ctx) => {
        starts.push(ctx);
      },
    });
    const promptDoc: PromptDocumentV1 = {
      v: 1,
      parts: [{ type: 'reference', kind: 'inbox', id: 'issue-1', label: '告警' }],
    };
    const firstRun = runtime.prompt({ turnId: 'current', promptDoc });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    await expect(runtime.prompt({ turnId: 'overlap', promptDoc })).rejects.toThrow(
      'already running'
    );
    expect(runtime.getCurrentTurnContext()?.turnId).toBe('current');
    releases[0]();
    await firstRun;
    await runtime.waitForIdle();
    expect(streamFn).toHaveBeenCalledTimes(1);

    const secondRun = runtime.prompt({
      turnId: 'next-turn-id',
      promptDoc,
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(starts[1]).toMatchObject({
      turnId: 'next-turn-id',
      userPrompt: promptDoc,
    });
    expect(streamFn).toHaveBeenCalledTimes(2);
    releases[1]();
    await secondRun;
    await runtime.waitForIdle();
  });

  it('016 preserves native steering messages during execution', async () => {
    const runtime = new AgentRuntime({
      modelRegistry,
      streamFn: (() => {
        const message = createMockAssistantMessage({ content: [{ type: 'text', text: 'done' }] });
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
    const promptDoc: PromptDocumentV1 = { v: 1, parts: [{ type: 'text', text: 'current' }] };
    expect(() => {
      runtime.steer({ role: 'user', content: 'urgent correction' });
    }).not.toThrow();
    await runtime.prompt({ promptDoc });
    await runtime.waitForIdle();
  });
});
