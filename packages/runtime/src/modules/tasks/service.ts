import {
  resolveTerminalAction,
  executeTerminalAction,
  formatActionShellCommand,
} from '../../infrastructure/dispatch/index.js';
import {
  listTasks,
  getTask,
  getSessionRef,
  listTaskEvents,
  getDispatchAttemptIdForTask,
} from './repository.js';
import type {
  ListTasksOptions,
  TaskDetails,
  TaskRecord,
  TaskServiceDependencies,
  TaskSummary,
  TaskTerminalResult,
} from './types.js';

export class TaskServiceError extends Error {
  constructor(
    readonly code: 'TASK_NOT_FOUND' | 'SESSION_UNAVAILABLE',
    message: string
  ) {
    super(message);
    this.name = 'TaskServiceError';
  }
}

export class TaskService {
  constructor(private dependencies: TaskServiceDependencies) {}

  list(options: ListTasksOptions = {}): TaskSummary[] {
    const db = this.dependencies.db;
    return listTasks(db, options).map((task) => ({
      ...task,
      sessionRef: getSessionRef(db, task.id),
    }));
  }

  get(taskId: string): TaskDetails {
    const db = this.dependencies.db;
    const task = this.requireTask(taskId);
    return {
      task,
      sessionRef: getSessionRef(db, taskId),
      events: listTaskEvents(db, taskId),
    };
  }

  async openTerminal(taskId: string): Promise<TaskTerminalResult> {
    const db = this.dependencies.db;
    const task = this.requireTask(taskId);
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
    });
    const execution = await executeTerminalAction(action);
    return {
      success: execution.success,
      actionType: action.type,
      shellCommand: formatActionShellCommand(action),
      error: execution.error,
      permissionDenied: execution.permissionDenied,
      notice:
        execution.success && action.type === 'resume' && task.agent === 'claude'
          ? `已打开原会话。Claude 首次访问 ${action.cwd || '工作目录'} 时可能要求确认目录信任，请在终端选择 Yes, I trust this folder；完全授权模式已启用。`
          : undefined,
    };
  }

  private requireTask(taskId: string): TaskRecord {
    const task = getTask(this.dependencies.db, taskId);
    if (!task) {
      throw new TaskServiceError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    }
    return task;
  }
}
