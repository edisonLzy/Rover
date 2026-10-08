import type { WebSocketManager } from '../../transport/websocket.js';
import {
  loadInboxConfig,
  saveInboxConfig,
  maskWecomConfig,
  type RoverInboxConfig,
  type WecomInboxConfig,
  type MaskedWecomInboxConfig,
} from './config.js';
import { WecomInboxProvider, type WecomConfig } from './providers/wecom.js';
import type { InboxRepository } from './repository.js';
import type {
  ConnectionTestResult,
  InboxMessageRecord,
  InboxProvider,
  InboxProviderStatus,
  IncomingInboxEvent,
  IngestEventResult,
  ListInboxMessagesOptions,
} from './types.js';

export interface InboxServiceOptions {
  repository: InboxRepository;
  wsManager?: WebSocketManager;
  customConfigPath?: string;
  wecomProvider?: InboxProvider<WecomConfig>;
  autoStart?: boolean;
}

/**
 * Inbox 领域核心服务协调器 (ADR-0020 & Ticket 003)
 * 职责：
 * 1. 统一管理外部输入 Provider 驱动（企业微信等）
 * 2. 桥接入站事件到 InboxRepository 完成持久化与幂等消重
 * 3. 消息落库后通过 WebSocketManager 广播实时变更，更新桌面端红点与徽标
 * 4. 维护 ~/.rover/inbox.json 本地配置热插拔与启停控制
 */
export class InboxService {
  private readonly repository: InboxRepository;
  private readonly wsManager?: WebSocketManager;
  private readonly customConfigPath?: string;
  private readonly providers = new Map<string, InboxProvider<any>>();
  private currentConfig: RoverInboxConfig;

  constructor(options: InboxServiceOptions) {
    this.repository = options.repository;
    this.wsManager = options.wsManager;
    this.customConfigPath = options.customConfigPath;

    // 1. 加载持久化配置
    this.currentConfig = loadInboxConfig(this.customConfigPath);

    // 2. 注册默认 Provider 驱动
    const wecomProvider = options.wecomProvider ?? new WecomInboxProvider();
    this.registerProvider(wecomProvider);

    // 3. 按配置自动启动已开启的长连接（默认开启 autoStart）
    if (options.autoStart !== false) {
      void this.init().catch((err) => {
        console.error('[InboxService] 自动启动 Provider 发生未捕获异常:', err);
      });
    }
  }

  /**
   * 注册消息 Provider 并挂载消息与状态监听管线
   */
  public registerProvider<TConfig>(provider: InboxProvider<TConfig>): void {
    this.providers.set(provider.id, provider);

    // 挂载消息分发管线
    provider.onMessage(async (event: IncomingInboxEvent) => {
      await this.handleIncomingEvent(event);
    });

    // 挂载状态变动监听
    provider.onStatusChange?.((status: InboxProviderStatus, error?: string) => {
      this.handleProviderStatusChange(provider.id, status, error);
    });
  }

  /**
   * 获取指定 Provider 实例
   */
  public getProvider<TConfig = unknown>(id: string): InboxProvider<TConfig> | undefined {
    return this.providers.get(id);
  }

  /**
   * 获取指定 Provider 运行状态
   */
  public getProviderStatus(id = 'wecom'): InboxProviderStatus {
    const provider = this.providers.get(id);
    return provider ? provider.getStatus() : 'disabled';
  }

  /**
   * 启动初始化：如果已配置启用则拉起长连接
   */
  public async init(): Promise<void> {
    this.currentConfig = loadInboxConfig(this.customConfigPath);
    const wecomCfg = this.currentConfig.wecom;

    if (wecomCfg.enabled) {
      const provider = this.providers.get('wecom');
      if (provider && wecomCfg.botId && wecomCfg.botSecret) {
        try {
          await provider.start({
            botId: wecomCfg.botId,
            botSecret: wecomCfg.botSecret,
            wsUrl: wecomCfg.wsUrl,
          });
        } catch (error) {
          console.error('[InboxService] 启动企业微信 Provider 失败:', error);
        }
      }
    }
  }

  /**
   * 优雅停机：释放所有 Provider 长连接与句柄
   */
  public async stopAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      try {
        await provider.stop();
      } catch (error) {
        console.error(`[InboxService] 停止 Provider (${provider.id}) 失败:`, error);
      }
    }
  }

  /**
   * 消费并持久化入站事件，并在成功落库时向桌面端广播事件
   */
  public async handleIncomingEvent(event: IncomingInboxEvent): Promise<IngestEventResult> {
    const result = this.repository.ingestEvent(event);

    if (result.applied && (result.isNew || result.message)) {
      const unreadCount = this.repository.getUnreadCount();
      this.broadcastChanged({
        type: 'event_ingested',
        message: result.message,
        unreadCount,
      });
    }

    return result;
  }

  /**
   * 动态应用企业微信配置（支持热启停与密钥智能合并）
   */
  public async applyWecomConfig(
    patch: Partial<WecomInboxConfig>
  ): Promise<WecomInboxConfig | MaskedWecomInboxConfig> {
    // 重新从磁盘读取基础配置，保证单源真实
    this.currentConfig = loadInboxConfig(this.customConfigPath);
    const current = this.currentConfig.wecom;

    // 智能合并密钥：如果前端传入掩码或空串，保留原有保存的真实密钥
    let nextSecret = current.botSecret;
    if (patch.botSecret !== undefined && patch.botSecret.trim() !== '') {
      const trimmed = patch.botSecret.trim();
      if (!trimmed.includes('••••')) {
        nextSecret = trimmed;
      }
    }

    const nextWecom: WecomInboxConfig = {
      enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
      botId: patch.botId !== undefined ? patch.botId.trim() : current.botId,
      botSecret: nextSecret,
      wsUrl: patch.wsUrl !== undefined ? patch.wsUrl : current.wsUrl,
    };

    // 1. 持久化至磁盘
    this.currentConfig.wecom = nextWecom;
    saveInboxConfig(this.currentConfig, this.customConfigPath);

    // 2. 动态联动 Provider 长连接状态
    const provider = this.providers.get('wecom');
    if (provider) {
      if (nextWecom.enabled) {
        if (nextWecom.botId && nextWecom.botSecret) {
          await provider.start({
            botId: nextWecom.botId,
            botSecret: nextWecom.botSecret,
            wsUrl: nextWecom.wsUrl,
          });
        } else {
          // 开启了但凭证不全，停止连接
          await provider.stop();
        }
      } else {
        // 关闭开关，断开长连接
        await provider.stop();
      }
    }

    return nextWecom;
  }

  /**
   * 读取企业微信配置（默认脱敏，支持 unmask 显式查看）
   */
  public getWecomConfig(options?: { unmask?: boolean }): WecomInboxConfig | MaskedWecomInboxConfig {
    this.currentConfig = loadInboxConfig(this.customConfigPath);
    if (options?.unmask) {
      return { ...this.currentConfig.wecom };
    }
    return maskWecomConfig(this.currentConfig.wecom);
  }

  /**
   * 测试企业微信连通性（不干扰主连接）
   */
  public async testWecomConnection(
    overrideConfig?: Partial<WecomConfig>
  ): Promise<ConnectionTestResult> {
    const provider = this.providers.get('wecom');
    if (!provider || typeof provider.testConnection !== 'function') {
      return { success: false, error: '未注册企业微信 Provider 或底层不支持测试握手' };
    }

    this.currentConfig = loadInboxConfig(this.customConfigPath);
    const saved = this.currentConfig.wecom;

    let targetSecret = saved.botSecret;
    if (overrideConfig?.botSecret && !overrideConfig.botSecret.includes('••••')) {
      targetSecret = overrideConfig.botSecret.trim();
    }

    const testTarget: WecomConfig = {
      botId: overrideConfig?.botId?.trim() || saved.botId || '',
      botSecret: targetSecret || '',
      wsUrl: overrideConfig?.wsUrl || saved.wsUrl,
    };

    if (!testTarget.botId || !testTarget.botSecret) {
      return { success: false, error: '缺少 botId 或 botSecret' };
    }

    return provider.testConnection(testTarget);
  }

  // --- 业务数据查询与状态操作代理 ---

  public listMessages(options?: ListInboxMessagesOptions): InboxMessageRecord[] {
    return this.repository.listMessages(options);
  }

  public getMessageById(id: string): InboxMessageRecord | null {
    return this.repository.getMessageById(id);
  }

  public getUnreadCount(): number {
    return this.repository.getUnreadCount();
  }

  public markAsRead(ids: string[]): void {
    this.repository.markAsRead(ids);
    this.broadcastChanged({ type: 'status_updated' });
  }

  public markAsDelegated(id: string): boolean {
    const success = this.repository.markAsDelegated(id);
    if (success) {
      this.broadcastChanged({ type: 'status_updated', messageId: id });
    }
    return success;
  }

  public markDelegated(id: string): boolean {
    return this.markAsDelegated(id);
  }

  public linkTask(id: string, taskId: string): boolean {
    const success = this.repository.linkTask(id, taskId);
    if (success) {
      this.broadcastChanged({ type: 'task_linked', messageId: id, taskId });
    }
    return success;
  }

  // --- 内部辅助广播方法 ---

  private broadcastChanged(detail?: Record<string, unknown>): void {
    const unreadCount = this.repository.getUnreadCount();
    this.wsManager?.broadcast({
      type: 'inbox.changed',
      payload: {
        unreadCount,
        ...detail,
      },
    });
  }

  private handleProviderStatusChange(
    providerId: string,
    status: InboxProviderStatus,
    error?: string
  ): void {
    this.wsManager?.broadcast({
      type: 'inbox.provider.status',
      payload: {
        providerId,
        status,
        error,
      },
    });
  }
}
