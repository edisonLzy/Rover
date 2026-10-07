import type {
  AgentMessage as CoreAgentMessage,
  AgentTool,
  StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import type { PromptDocumentV1 } from '../../types/prompt.js';
import type { ModelRegistry } from '../models/registry.js';
import type { BuiltinSkillService } from '../skills/service.js';
import type { SystemPromptService } from './runtime/prompts.js';

export type RoverTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface RoverTurnRecord {
  id: string;
  status: RoverTurnStatus;
  promptDoc: Record<string, unknown>;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export type AgentRole = 'user' | 'assistant' | 'toolResult' | 'system';

export interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'toolResult';
  toolCallId: string;
  toolName?: string;
  content: unknown;
  isError?: boolean;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type ContentBlock =
  | TextBlock
  | ToolCallBlock
  | ToolResultBlock
  | ThinkingBlock
  | Record<string, unknown>;

export interface AgentMessage {
  role: AgentRole;
  content: ContentBlock[] | string;
  model?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  stopReason?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface CompactionPayload {
  summary: string;
  coveredThroughSeq: number;
  previousCompactionId: string | null;
  policyVersion: number;
  provider?: string;
  model?: string;
  tokensBefore?: number;
  tokensAfter?: number;
}

export type RoverEntryType = 'message' | 'compaction';

export interface RoverEntryRecord<T = AgentMessage | CompactionPayload> {
  seq: number;
  id: string;
  turnId: string | null;
  type: RoverEntryType;
  schemaVersion: number;
  data: T;
  createdAt: number;
}

export interface EffectiveHistory {
  compaction: RoverEntryRecord<CompactionPayload> | null;
  messages: RoverEntryRecord<AgentMessage>[];
  latestSeq: number;
}

export interface CreateTurnInput {
  id: string;
  promptDoc: Record<string, unknown>;
  createdAt?: number;
}

export interface UpdateTurnStatusInput {
  id: string;
  status: RoverTurnStatus;
  error?: string | null;
  completedAt?: number;
}

export interface AppendMessageEntryInput {
  id?: string;
  turnId?: string | null;
  message: AgentMessage;
  schemaVersion?: number;
  createdAt?: number;
}

export interface AppendCompactionEntryInput {
  id?: string;
  compaction: CompactionPayload;
  schemaVersion?: number;
  createdAt?: number;
}

export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  beforeSeq?: number;
  afterSeq?: number;
  turnId?: string;
  type?: RoverEntryType;
  order?: 'asc' | 'desc';
}

export interface HistoryStats {
  totalEntries: number;
  totalMessages: number;
  totalCompactions: number;
  totalTurns: number;
  latestSeq: number;
}

export interface ListRoverTurnsOptions {
  limit?: number;
  offset?: number;
}

export interface TurnContext {
  turnId: string;
  sessionId?: string;
  userPrompt?: PromptDocumentV1;
  model?: Model<any>;
  startTime: number;
}

export interface MessageDeltaEvent {
  delta: string;
  accumulated: string;
  isThinking: boolean;
}

export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface TurnEndResult {
  status: 'completed' | 'cancelled' | 'failed';
  latencyMs: number;
  error?: string | null;
}

export interface AgentRuntimeEventCallbacks {
  onTurnStart?(context: TurnContext): Promise<void> | void;
  onTurnStepStart?(context: TurnContext): Promise<void> | void;
  onMessageDelta?(context: TurnContext, event: MessageDeltaEvent): Promise<void> | void;
  onMessageEnd?(context: TurnContext, message: CoreAgentMessage): Promise<void> | void;
  onToolExecutionStart?(context: TurnContext, event: ToolCallEvent): Promise<void> | void;
  onToolExecutionEnd?(context: TurnContext, event: ToolResultEvent): Promise<void> | void;
  onTurnEnd?(context: TurnContext, result: TurnEndResult): Promise<void> | void;
  onError?(context: TurnContext, error: Error): Promise<void> | void;
}

export interface PromptInput {
  turnId?: string;
  promptDoc: PromptDocumentV1;
  model?: Model<any>;
  signal?: AbortSignal;
}

export interface AgentRuntimeOptions {
  modelRegistry?: ModelRegistry;
  skillService?: BuiltinSkillService;
  skillsDir?: string;
  systemPromptService?: SystemPromptService;
  systemPrompt?: string;
  tools?: AgentTool[];
  streamFn?: StreamFn;
}

export interface StartTurnInput {
  promptDoc: PromptDocumentV1;
  turnId?: string;
}

export interface StartTurnResult {
  turnId: string;
  status: 'running';
}

export interface TurnDetails {
  turn: RoverTurnRecord | null;
  entries: RoverEntryRecord<AgentMessage>[];
}

export interface AgentServiceDependencies {
  runtime: import('./runtime/runtime.js').AgentRuntime;
  db: import('better-sqlite3').Database;
}
