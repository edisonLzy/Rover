import crypto from 'node:crypto';
import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import { PromptDocumentV1Schema } from '../../../types/prompt.js';
import {
  parsePromptDocumentContent,
  buildRoverSystemPrompt,
  SystemPromptService,
} from './prompts.js';
import { ModelRegistry } from '../../models/index.js';
import { BuiltinSkillService } from '../../skills/index.js';
import type {
  AgentRuntimeEventCallbacks,
  AgentRuntimeOptions,
  PromptInput,
  TurnContext,
} from '../types.js';

/**
 * 纯领域 AgentRuntime (ADR-0018 & ADR-0019)
 *
 * 核心执行回路，零外部 SQLite 数据库和 WebSocket 协议依赖。
 * 负责维护 @earendil-works/pi-agent-core 实例、三模态输入队列 (Prompt, Steer, Follow-Up)
 * 以及强类型生命周期事件回调 (AgentRuntimeEventCallbacks) 的分发与容错隔离。
 */
export class AgentRuntime {
  private agent: Agent;
  private callbacks: AgentRuntimeEventCallbacks[] = [];
  private currentTurnContext: TurnContext | null = null;
  private isCancelled = false;
  private turnError: string | null = null;

  private modelRegistry: ModelRegistry;
  private skillService?: BuiltinSkillService;
  private systemPromptService: SystemPromptService;
  private tools: AgentTool[];
  private streamFn?: StreamFn;
  private options: AgentRuntimeOptions;

  constructor(options: AgentRuntimeOptions = {}) {
    this.options = options;
    this.modelRegistry = options.modelRegistry || new ModelRegistry();
    this.skillService =
      options.skillService ||
      (options.skillsDir ? new BuiltinSkillService({ skillsDir: options.skillsDir }) : undefined);
    this.tools = options.tools ? [...options.tools] : [];
    this.streamFn = options.streamFn;

    // 系统提示词构建服务
    this.systemPromptService = options.systemPromptService || new SystemPromptService();
    if (!options.systemPromptService) {
      this.systemPromptService.addBuilder({
        buildSystemPrompt: (raw) => {
          const base = buildRoverSystemPrompt({
            tools: this.tools.map((t) => ({ name: t.name, description: t.description })),
            customInstructions: options.systemPrompt,
          });
          return raw ? `${base}\n\n${raw}` : base;
        },
      });
      if (this.skillService) {
        this.systemPromptService.addBuilder(this.skillService);
      }
    }

    this.agent = this.createInternalAgent();
  }

  // ── Callbacks 管理与触发 ────────────────────────────────────────────────

  /**
   * 注册事件回调，返回清理函数
   */
  public addEventCallbacks(callbacks: AgentRuntimeEventCallbacks): () => void {
    this.callbacks.push(callbacks);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callbacks);
    };
  }

  public getModelRegistry(): ModelRegistry {
    return this.modelRegistry;
  }

  public getSkillService(): BuiltinSkillService | undefined {
    return this.skillService;
  }

  public isTurnRunning(turnId?: string): boolean {
    if (turnId) return this.currentTurnContext?.turnId === turnId;
    return !!this.currentTurnContext || this.agent.state.isStreaming;
  }

  /**
   * 安全触发指定生命周期回调，容错隔离单个 Callback 抛错
   */
  public async triggerCallback<K extends keyof AgentRuntimeEventCallbacks>(
    method: K,
    ...args: Parameters<NonNullable<AgentRuntimeEventCallbacks[K]>>
  ): Promise<void> {
    for (const cb of this.callbacks) {
      const handler = cb[method];
      if (typeof handler === 'function') {
        try {
          await (handler as any).apply(cb, args);
        } catch (err) {
          console.error(`[AgentRuntime] Error in callback '${String(method)}':`, err);
        }
      }
    }
  }

  // ── 核心输入与执行接口 ──────────────────────────────────────────────────

  /**
   * 启动常规回合 (Prompt)
   *
   * 关键规范 (ADR-0019)：在正式调用底层 agent.prompt 之前前置主动触发 onTurnStart，
   * 确保 SQLite WAL 先行落盘，杜绝异常穿透导致漏记。
   */
  public async prompt(input: PromptInput): Promise<string> {
    if (this.currentTurnContext || this.agent.state.isStreaming) {
      throw new Error('A Rover turn is already running');
    }
    const validDoc = PromptDocumentV1Schema.parse(input.promptDoc);
    const turnId = input.turnId || crypto.randomUUID();
    const startTime = Date.now();

    const targetModel = input.model || this.modelRegistry.resolveActiveModel();

    const context: TurnContext = {
      turnId,
      userPrompt: validDoc,
      model: targetModel,
      startTime,
    };

    this.currentTurnContext = context;
    this.isCancelled = false;
    this.turnError = null;

    // 1. 【核心时机】前置主动触发 onTurnStart (WAL 先行落盘与 UI 活跃状态同步)
    await this.triggerCallback('onTurnStart', context);

    if (this.isCancelled || this.currentTurnContext !== context) {
      return turnId;
    }

    if (!targetModel) {
      const err = new Error('No active model configured in models registry');
      this.turnError = err.message;
      await this.triggerCallback('onError', context, err);
      await this.handleAgentEnd(context);
      throw err;
    }

    this.agent.state.model = targetModel;
    this.agent.state.systemPrompt = this.systemPromptService.buildSystemPrompt('');

    // 2. 外部 Abort 信号绑定
    if (input.signal) {
      input.signal.addEventListener(
        'abort',
        () => {
          this.abortPrompt();
        },
        { once: true }
      );
    }

    // 3. 构建用户消息并启动底层回路
    const parsed = parsePromptDocumentContent(validDoc);
    const userMessage: AgentMessage = {
      role: 'user',
      content: parsed.plainText,
      timestamp: startTime,
    } as AgentMessage;

    try {
      await this.agent.prompt(userMessage);
      if (this.turnError || this.agent.state.errorMessage) {
        throw new Error(this.turnError || this.agent.state.errorMessage!);
      }
    } catch (err) {
      if (this.isCancelled) {
        return turnId;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.turnError = errorMsg;
      if (err instanceof Error) {
        await this.triggerCallback('onError', context, err);
      }
      await this.handleAgentEnd(context);
      throw err;
    }

    return turnId;
  }

  /**
   * 高优先级插话干预 (Steer)
   *
   * 直达底层 Agent 核心 steeringQueue，在工具执行间隙和模型请求前优先消费，不触发 onTurnStart。
   */
  public steer(message: AgentMessage | { content: string }): void {
    const routedMessage = (
      typeof message === 'object' && 'role' in message
        ? message
        : {
            role: 'user',
            content: (message as { content: string }).content,
            timestamp: Date.now(),
          }
    ) as AgentMessage;

    this.agent.steer(routedMessage);
  }

  /**
   * 后续排队追问 (Follow-Up)
   *
   * 入列底层 followUpQueue，在当前轮次工具执行完毕后消费。
   */
  public followUp(message: AgentMessage | { content: string }): void {
    const routedMessage = (
      typeof message === 'object' && 'role' in message
        ? message
        : {
            role: 'user',
            content: (message as { content: string }).content,
            timestamp: Date.now(),
          }
    ) as AgentMessage;

    this.agent.followUp(routedMessage);
  }

  /**
   * 清空所有待消费排队消息 (Steering & Follow-Up)
   */
  public clearAllQueues(): void {
    this.agent.clearAllQueues();
  }

  /**
   * 中断当前执行
   */
  public abortPrompt(): void {
    this.isCancelled = true;
    const context = this.currentTurnContext;
    if (this.agent.state.isStreaming || (this.agent as any).activeRun) {
      this.agent.abort();
    } else if (context) {
      void this.handleAgentEnd(context);
    }
  }

  /**
   * 等待 Agent 空闲
   */
  public waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  /**
   * 获取当前活跃回合上下文
   */
  public getCurrentTurnContext(): TurnContext | null {
    return this.currentTurnContext;
  }

  /**
   * 是否正处于生成或流式响应中
   */
  public get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  /**
   * 获取当前注册的工具列表
   */
  public getTools(): AgentTool[] {
    return [...this.tools];
  }

  /**
   * 动态注册工具
   */
  public registerTool(tool: AgentTool): void {
    this.tools.push(tool);
    this.agent.state.tools = [...this.tools];
  }

  // ── 内部初始化与底层事件映射 ──────────────────────────────────────────

  private createInternalAgent(): Agent {
    const activeModel = this.modelRegistry.resolveActiveModel();

    const agent = new Agent({
      ...(this.streamFn ? { streamFn: this.streamFn } : {}),
      convertToLlm: (messages) => {
        return messages.flatMap((message): Message[] => {
          if (message.role === 'user') {
            return [
              {
                role: 'user',
                content: message.content,
                timestamp: message.timestamp,
              },
            ];
          }

          if (message.role === 'assistant' || message.role === 'toolResult') {
            return [message as Message];
          }

          return [];
        });
      },
      getApiKey: (provider) => {
        return this.modelRegistry.resolveApiKey(provider);
      },
      initialState: {
        model: activeModel,
        systemPrompt: this.systemPromptService.buildSystemPrompt(''),
        tools: [...this.tools],
        messages: [],
      },
    });

    this.bindAgentSubscriptions(agent);
    return agent;
  }

  private bindAgentSubscriptions(agent: Agent): void {
    agent.subscribe(async (event) => {
      const context = this.currentTurnContext;
      if (!context) {
        return;
      }

      switch (event.type) {
        case 'turn_start': {
          await this.triggerCallback('onTurnStepStart', context);
          break;
        }

        case 'message_update': {
          const update = event.assistantMessageEvent;
          if (!update) break;

          if (update.type === 'text_delta' && update.delta) {
            const accumulated = this.extractAccumulatedContent(event.message, false);
            await this.triggerCallback('onMessageDelta', context, {
              delta: update.delta,
              accumulated,
              isThinking: false,
            });
          } else if (update.type === 'thinking_delta' && update.delta) {
            const accumulated = this.extractAccumulatedContent(event.message, true);
            await this.triggerCallback('onMessageDelta', context, {
              delta: update.delta,
              accumulated,
              isThinking: true,
            });
          }
          break;
        }

        case 'message_end': {
          if (event.message.role === 'assistant' || event.message.role === 'toolResult') {
            await this.triggerCallback('onMessageEnd', context, event.message);
          }
          break;
        }

        case 'tool_execution_start': {
          await this.triggerCallback('onToolExecutionStart', context, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args:
              typeof event.args === 'object' && event.args !== null
                ? (event.args as Record<string, unknown>)
                : {},
          });
          break;
        }

        case 'tool_execution_end': {
          await this.triggerCallback('onToolExecutionEnd', context, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.result,
            isError: Boolean(event.isError),
          });
          break;
        }

        case 'turn_end': {
          if (event.message.role === 'assistant' && event.message.errorMessage) {
            this.turnError = event.message.errorMessage;
            await this.triggerCallback('onError', context, new Error(event.message.errorMessage));
          }
          break;
        }

        case 'agent_end': {
          await this.handleAgentEnd(context);
          break;
        }
      }
    });
  }

  private async handleAgentEnd(context: TurnContext): Promise<void> {
    // 防重保护：如果该 context 已经完成结算，不再重复触发
    if (this.currentTurnContext !== context) {
      return;
    }

    const latencyMs = context.startTime > 0 ? Date.now() - context.startTime : 0;
    const finalError = this.turnError || this.agent.state.errorMessage || null;
    const status = this.isCancelled ? 'cancelled' : finalError ? 'failed' : 'completed';

    this.currentTurnContext = null;

    // 触发终态决算回调
    await this.triggerCallback('onTurnEnd', context, {
      status,
      latencyMs,
      error: finalError,
    });

    this.turnError = null;
  }

  private extractAccumulatedContent(message: AgentMessage, isThinking: boolean): string {
    if (!Array.isArray(message.content)) return '';
    for (const part of message.content) {
      if (isThinking && 'thinking' in part && typeof part.thinking === 'string') {
        return part.thinking;
      }
      if (!isThinking && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
    }
    return '';
  }
}
