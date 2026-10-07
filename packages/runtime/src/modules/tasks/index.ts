export { TaskService, createTaskService, TaskServiceError } from './service.js';
export { tasksRouter } from './router.js';
export {
  TaskStateProjector,
  extractSourceEventId,
  type TaskStateProjectorOptions,
} from './projector.js';
export {
  insertDispatchAttempt,
  updateDispatchAttemptStatus,
  getDispatchAttempt,
  getDispatchAttemptIdForTask,
  commitTaskWithSession,
  getTask,
  listTasks,
  getSessionRef,
  listTaskEvents,
  insertTaskEvent,
  updateTaskStatus,
  updateSessionRefAvailability,
  findTaskByNativeSessionId,
  findTaskByAttemptId,
} from './repository.js';
export type {
  TaskAgent,
  TaskStatus,
  DispatchAttemptDbStatus,
  SessionAvailability,
  DispatchAttemptRecord,
  TaskRecord,
  SessionRefRecord,
  TaskEventRecord,
  TaskSummary,
  TaskDetails,
  TaskTerminalResult,
  ListTasksOptions,
  TaskServiceDependencies,
  InsertDispatchAttemptInput,
  CommitTaskWithSessionParams,
  InsertTaskEventInput,
  InsertTaskEventResult,
  UpdateTaskStatusInput,
} from './types.js';
