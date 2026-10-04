import type Database from 'better-sqlite3';
import type { SessionCarrier } from '../dispatch/carrier.js';
import type { AgentRegistry } from '../dispatch/dispatcher.js';
import {
  resolveTerminalAction,
  formatActionShellCommand,
  type TerminalAction,
  type TerminalActionType,
  type TerminalExecutionResult,
} from '../dispatch/terminal.js';
import {
  listTasks,
  getTask,
  getSessionRef,
  listTaskEvents,
  getDispatchAttemptIdForTask,
  type ListTasksOptions,
  type TaskRecord,
  type SessionRefRecord,
  type TaskEventRecord,
} from '../storage/index.js';

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
}

export interface TaskService {
  list(options?: ListTasksOptions): TaskSummary[];
  get(taskId: string): TaskDetails;
  openTerminal(taskId: string): Promise<TaskTerminalResult>;
}

export interface TaskServiceDependencies {
  getDatabase: () => Database.Database;
  carrier: SessionCarrier;
  registry: AgentRegistry;
  executeTerminal: (action: TerminalAction) => Promise<TerminalExecutionResult>;
}

export class TaskServiceError extends Error {
  constructor(
    readonly code: 'TASK_NOT_FOUND' | 'SESSION_UNAVAILABLE',
    message: string
  ) {
    super(message);
    this.name = 'TaskServiceError';
  }
}

export function createTaskService(dependencies: TaskServiceDependencies): TaskService {
  return {
    list(options = {}) {
      const db = dependencies.getDatabase();
      return listTasks(db, options).map((task) => ({
        ...task,
        sessionRef: getSessionRef(db, task.id),
      }));
    },

    get(taskId) {
      const db = dependencies.getDatabase();
      const task = requireTask(db, taskId);
      return {
        task,
        sessionRef: getSessionRef(db, taskId),
        events: listTaskEvents(db, taskId),
      };
    },

    async openTerminal(taskId) {
      const db = dependencies.getDatabase();
      const task = requireTask(db, taskId);
      const sessionRef = getSessionRef(db, taskId);
      if (!sessionRef) {
        throw new TaskServiceError(
          'SESSION_UNAVAILABLE',
          `No session reference found for task: ${taskId}`
        );
      }
      const action = await resolveTerminalAction({
        attemptId: getDispatchAttemptIdForTask(db, taskId) || task.id,
        agentType: task.agent,
        nativeSessionId: sessionRef.nativeSessionId,
        cwd: sessionRef.configDir,
        carrier: dependencies.carrier,
        registry: dependencies.registry,
      });
      const execution = await dependencies.executeTerminal(action);
      return {
        success: execution.success,
        actionType: action.type,
        shellCommand: formatActionShellCommand(action),
        error: execution.error,
        permissionDenied: execution.permissionDenied,
      };
    },
  };
}

function requireTask(db: Database.Database, taskId: string): TaskRecord {
  const task = getTask(db, taskId);
  if (!task) {
    throw new TaskServiceError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
  }
  return task;
}
