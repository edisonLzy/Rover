import type Database from 'better-sqlite3';
import type { TerminalActionType } from '../../infrastructure/dispatch/terminal.js';
import type { WebSocketManager } from '../../transport/websocket.js';

export type TaskAgent = 'claude' | 'codex' | 'opencode';
export type TaskStatus = 'running' | 'needs_intervention' | 'completed' | 'failed' | 'unverified';
export type DispatchAttemptDbStatus = 'starting' | 'registered' | 'failed';
export type SessionAvailability = 'available' | 'unavailable';

export interface DispatchAttemptRecord {
  id: string;
  candidateTaskId: string;
  sourceKind: 'turn' | 'plan' | 'inbox';
  sourceId: string;
  agent: TaskAgent;
  cwd: string;
  status: DispatchAttemptDbStatus;
  nativeSessionId: string | null;
  reportTokenHash: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskRecord {
  id: string;
  goal: string;
  agent: TaskAgent;
  status: TaskStatus;
  progressText: string | null;
  resultText: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionRefRecord {
  taskId: string;
  agent: TaskAgent;
  nativeSessionId: string;
  configDir: string;
  carrierKind: string;
  carrierName: string;
  availability: SessionAvailability;
  lastSeen: number;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  source: string;
  sourceEventId: string;
  kind: string;
  observedAt: number;
  summary: string | null;
  evidenceRef: string | null;
}

export interface TaskSummary extends TaskRecord {
  sessionRef: SessionRefRecord | null;
}

export interface TaskDetails {
  task: TaskRecord;
  sessionRef: SessionRefRecord | null;
  events: TaskEventRecord[];
}

export interface TaskTerminalResult {
  success: boolean;
  actionType: TerminalActionType;
  shellCommand: string;
  error?: string;
  permissionDenied?: boolean;
  notice?: string;
}

export interface ListTasksOptions {
  limit?: number;
  status?: TaskStatus;
}

export interface InsertDispatchAttemptInput {
  id: string;
  candidateTaskId: string;
  sourceKind: 'turn' | 'plan' | 'inbox';
  sourceId: string;
  agent: TaskAgent;
  cwd: string;
  reportToken: string;
  status?: DispatchAttemptDbStatus;
  nativeSessionId?: string | null;
  error?: string | null;
  createdAt?: number;
}

export interface CommitTaskWithSessionParams {
  attemptId: string;
  taskId: string;
  goal: string;
  agent: TaskAgent;
  nativeSessionId: string;
  configDir: string;
  carrierName: string;
  carrierKind?: string;
  wsManager?: WebSocketManager;
  initialEventSummary?: string;
  createdAt?: number;
}

export interface InsertTaskEventInput {
  id?: string;
  taskId: string;
  source: string;
  sourceEventId: string;
  kind: string;
  observedAt?: number;
  summary?: string | null;
  evidenceRef?: string | null;
}

export interface InsertTaskEventResult {
  inserted: boolean;
  event: TaskEventRecord;
}

export interface UpdateTaskStatusInput {
  taskId: string;
  status: TaskStatus;
  progressText?: string | null;
  resultText?: string | null;
  updatedAt?: number;
  wsManager?: WebSocketManager;
}

export interface TaskService {
  list(options?: ListTasksOptions): TaskSummary[];
  get(taskId: string): TaskDetails;
  openTerminal(taskId: string): Promise<TaskTerminalResult>;
}

export interface TaskServiceDependencies {
  db: Database.Database;
}
