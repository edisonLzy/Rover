import type Database from 'better-sqlite3';

export interface DatabaseOptions {
  /**
   * Path to the SQLite database file.
   * Special value ':memory:' creates an in-memory database.
   * If omitted, falls back to process.env.ROVER_DB_PATH or macOS default path.
   */
  path?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
}

export interface RoverDatabase {
  raw: Database.Database;
  path: string;
  isMemory: boolean;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface RuntimeEvent<T = unknown> {
  eventSeq: number;
  eventType: string;
  payload: T;
  createdAt: number;
}

export interface AppendEventOptions {
  eventType: string;
  payload: unknown;
  createdAt?: number;
}

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
  content: unknown;
  isError?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface TextBlock {
  type: 'text';
  text: string;
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
