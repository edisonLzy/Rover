import type { AgentMessage, AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import type { PromptDocumentV1 } from '../types/prompt.js';
import type { ModelRegistry } from '../models/index.js';
import type { BuiltinSkillService } from './skills/skill-service.js';
import type { SystemPromptService } from './prompts.js';

/**
 * 回合执行上下文信息
 */
export interface TurnContext {
  turnId: string;
  sessionId?: string;
  userPrompt?: PromptDocumentV1;
  model?: Model<any>;
  startTime: number;
}

/**
 * 流式增量内容
 */
export interface MessageDeltaEvent {
  delta: string;
  accumulated: string;
  isThinking: boolean;
}

/**
 * 工具调用发起事件信息
 */
export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * 工具调用执行完毕事件信息
 */
export interface ToolResultEvent {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

/**
 * 回合终态决算结果
 */
export interface TurnEndResult {
  status: 'completed' | 'cancelled' | 'failed';
  latencyMs: number;
  error?: string | null;
}

/**
 * Agent 运行时生命周期事件回调规范 (ADR-0019)
 */
export interface AgentRuntimeEventCallbacks {
  /** 回合开始（入口前置主动触发，确保 SQLite WAL 先行） */
  onTurnStart?(context: TurnContext): Promise<void> | void;

  /** 单步 Step 开始（大模型发起单次推理交互） */
  onTurnStepStart?(context: TurnContext): Promise<void> | void;

  /** 流式 Token 增量产生（区分文本与思考增量） */
  onMessageDelta?(context: TurnContext, event: MessageDeltaEvent): Promise<void> | void;

  /** 单条完整消息生成完毕（assistant 或 toolResult 结算完毕，WAL 先行落盘核心点） */
  onMessageEnd?(context: TurnContext, message: AgentMessage): Promise<void> | void;

  /** 工具调用开始执行 */
  onToolExecutionStart?(context: TurnContext, event: ToolCallEvent): Promise<void> | void;

  /** 工具调用执行结束 */
  onToolExecutionEnd?(context: TurnContext, event: ToolResultEvent): Promise<void> | void;

  /** 回合终态决算（completed / cancelled / failed） */
  onTurnEnd?(context: TurnContext, result: TurnEndResult): Promise<void> | void;

  /** 异常捕获 */
  onError?(context: TurnContext, error: Error): Promise<void> | void;
}

/**
 * 常规 Prompt 输入参数
 */
export interface PromptInput {
  turnId?: string;
  promptDoc: PromptDocumentV1;
  model?: Model<any>;
  signal?: AbortSignal;
}

/**
 * AgentRuntime 初始化选项
 */
export interface AgentRuntimeOptions {
  modelRegistry?: ModelRegistry;
  skillService?: BuiltinSkillService;
  systemPromptService?: SystemPromptService;
  systemPrompt?: string;
  tools?: AgentTool[];
  streamFn?: StreamFn;
}
