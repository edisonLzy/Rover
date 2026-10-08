/**
 * Inbox 领域模型契约类型
 * 对齐 Rover Inbox 投递协议 v1 (TRD 第 8 节, ADR-0005, ADR-0018)
 */

export type InboxMessageStatus = 'unread' | 'read' | 'delegated' | 'resolved';

/**
 * Inbox 业务消息投影持久化记录
 */
export interface InboxMessageRecord {
  id: string;
  sourceId: string;
  sourceMessageId: string;
  revision: number;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  status: InboxMessageStatus;
  taskId: string | null;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  payload: Record<string, unknown> | null;
}

/**
 * Inbox 事件日志与幂等去重记录
 */
export interface InboxEventRecord {
  id: string;
  sourceId: string;
  sourceEventId: string;
  receivedAt: number;
  payload: Record<string, unknown>;
}

/**
 * 标准入站投递事件信封
 */
export interface IncomingInboxEvent<TPayload = Record<string, unknown>> {
  sourceId: string;
  sourceEventId: string;
  sourceMessageId: string;
  revision?: number;
  kind: string;
  title: string;
  summary?: string | null;
  url?: string | null;
  occurredAt?: number | string;
  payload?: TPayload;
}

/**
 * 事件入库消费结果
 */
export interface IngestEventResult {
  applied: boolean;
  reason?: 'duplicate_event' | 'stale_revision';
  isNew?: boolean;
  message?: InboxMessageRecord;
}

/**
 * 消息列表查询过滤参数
 */
export interface ListInboxMessagesOptions {
  status?: InboxMessageStatus | 'all';
  limit?: number;
  offset?: number;
}
