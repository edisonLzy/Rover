/**
 * Public types exposed by @rover/runtime for consumption by @rover/app and frontend clients.
 *
 * 约定规范（Strict Convention）：
 * 本文件仅用于对外导出纯 TypeScript 类型（type-only exports）。
 * 严禁导出任何运行时值、函数、类实例或 Schema 对象，以彻底杜绝向浏览器/Webview 客户端泄露 Node.js 服务端模块。
 */

// tRPC AppRouter & Context
export type { AppRouter, Context } from './transport/router.js';

// Prompt Document V1 Specification (Ticket 002)
export type {
  PromptDocumentV1,
  PromptPart,
  PromptTextPart,
  PromptReferencePart,
  PromptReferenceKind,
} from './types/prompt.js';

// Model Configuration Contract (Ticket 003 & ADR-0015)
export type {
  RoverModelsConfig,
  ProviderConfig,
  ModelConfig,
  ActiveModelConfig,
  ModelCost,
  MaskedProviderConfig,
  MaskedRoverModelsConfig,
  ModelConnectionTestResult,
} from './modules/models/types.js';

// Core Runtime Status & Config
export type { RuntimeConfig, RuntimeStatus } from './index.js';

// Runtime WebSocket Events Specification (ADR-0017)
export type {
  RuntimeEventType,
  RuntimeEventMap,
  RuntimeEventEnvelope,
  RuntimeEventHandlers,
  SystemReadyPayload,
  TurnStartedPayload,
  TurnStepStartedPayload,
  TurnDeltaPayload,
  TurnToolCallPayload,
  TurnToolResultPayload,
  TurnEndPayload,
  TaskChangedPayload,
  RoverEntryAppendedPayload,
  RoverCompactionAppendedPayload,
  InboxChangedPayload,
  InboxProviderStatusPayload,
  PermissionRequestedPayload,
} from './types/events.js';

// Human-in-the-Loop & Permission Contracts (Ticket 022b)
export type {
  HitlKind,
  HitlPayload,
  PermissionPayload,
  WorkspaceAccessPayload,
  DoomLoopPayload,
  HitlResolution,
  PermissionResolution,
  WorkspaceAccessResolution,
  DoomLoopResolution,
  PendingRequest,
  PermissionRequestEvent,
} from './modules/agent/hitl/types.js';

// Inbox Contracts (Ticket 001 - 003 & ADR-0005, ADR-0018)
export type {
  InboxMessageStatus,
  InboxMessageRecord,
  IncomingInboxEvent,
  ListInboxMessagesOptions,
  InboxProviderStatus,
  ConnectionTestResult,
} from './modules/inbox/types.js';
export type {
  WecomInboxConfig,
  RoverInboxConfig,
  MaskedWecomInboxConfig,
  MaskedRoverInboxConfig,
} from './modules/inbox/config.js';
