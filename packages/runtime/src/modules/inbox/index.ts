/**
 * Inbox Module Facade (ADR-0020 & AGENTS.md)
 * 严格对外导出 Inbox 模块公开的 Service、Repository、配置与契约类型。
 */

export { InboxService, type InboxServiceOptions } from './service.js';
export { InboxRepository } from './repository.js';
export { inboxRouter } from './router.js';
export {
  WecomInboxConfigSchema,
  RoverInboxConfigSchema,
  loadInboxConfig,
  saveInboxConfig,
  maskSecret,
  maskWecomConfig,
  maskInboxConfig,
  getInboxConfigPath,
  type WecomInboxConfig,
  type RoverInboxConfig,
  type MaskedWecomInboxConfig,
  type MaskedRoverInboxConfig,
} from './config.js';

export type {
  InboxMessageStatus,
  InboxMessageRecord,
  InboxEventRecord,
  IncomingInboxEvent,
  IngestEventResult,
  ListInboxMessagesOptions,
  InboxProviderStatus,
  ConnectionTestResult,
  InboxMessageDispatcher,
  ProviderStatusListener,
  InboxProvider,
} from './types.js';
