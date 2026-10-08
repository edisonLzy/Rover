/**
 * Tasks Module Facade (ADR-0020 & AGENTS.md)
 * 严格对外导出该模块公开的 Service、Router 和契约类型。
 */

export { TaskService, TaskServiceError } from './service.js';
export { tasksRouter } from './router.js';

export type {
  TaskAgent,
  TaskStatus,
  TaskRecord,
  TaskSummary,
  TaskDetails,
  TaskTerminalResult,
  ListTasksOptions,
} from './types.js';
