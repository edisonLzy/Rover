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

/**
 * Inbox 提供商连接与运行状态
 */
export type InboxProviderStatus =
  | 'disabled' // 未启用（开关关闭）
  | 'connecting' // 连接中 / 认证中
  | 'connected' // 已就绪 / 长连接正常
  | 'auth_failed' // 凭证错误或认证被拒（停止无效重试）
  | 'disconnected' // 网络异常断开（重试中）
  | 'error'; // 发生其他不可恢复异常

/**
 * 提供商连通性测试探针结果
 */
export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  error?: string;
  latencyMs?: number;
}

/**
 * 消息分发回调函数契约
 */
export type InboxMessageDispatcher = (event: IncomingInboxEvent) => Promise<void>;

/**
 * 状态变化监听回调契约
 */
export type ProviderStatusListener = (status: InboxProviderStatus, error?: string) => void;

/**
 * 统一 Inbox Provider 驱动核心接口
 * 供各类外部异步输入源（企业微信、飞书、钉钉、监控网关等）实现
 */
export interface InboxProvider<TConfig = unknown> {
  /** 唯一提供商标识，如 'wecom' */
  readonly id: string;

  /** 展示名称，如 '企业微信智能机器人' */
  readonly displayName: string;

  /** 获取当前运行状态 */
  getStatus(): InboxProviderStatus;

  /** 注册消息分发管道 */
  onMessage(dispatcher: InboxMessageDispatcher): void;

  /** 注册状态变更监听器 */
  onStatusChange?(listener: ProviderStatusListener): void;

  /** 启动连接 */
  start(config: TConfig): Promise<void>;

  /** 停止连接并释放所有资源 */
  stop(): Promise<void>;

  /** 测试连接连通性（不影响主连接） */
  testConnection?(config: TConfig): Promise<ConnectionTestResult>;

  /** （可选）双向回复通道：将结果回传至原会话 */
  reply?(event: IncomingInboxEvent, text: string): Promise<void>;
}
