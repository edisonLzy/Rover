/**
 * Agent Module Facade (ADR-0020 & AGENTS.md)
 * 严格对外导出该模块公开的 Service、Runtime、Router 和契约类型。
 */

export { AgentService } from './service.js';
export { AgentRuntime, createAgentRuntime } from './runtime/index.js';
export { turnsRouter, historyRouter } from './router.js';

export type {
  RoverTurnStatus,
  RoverTurnRecord,
  RoverEntryRecord,
  RoverEntryType,
  AgentRole,
  AgentMessage,
  EffectiveHistory,
  HistoryStats,
  StartTurnResult,
  TurnDetails,
  TurnEndResult,
  TurnContext,
  AgentRuntimeOptions,
  AgentServiceDependencies,
  PromptInput,
} from './types.js';
