import AiBot, {
  generateReqId,
  WSAuthFailureError,
  WSReconnectExhaustedError,
} from '@wecom/aibot-node-sdk';
import type {
  InboxProvider,
  InboxProviderStatus,
  IncomingInboxEvent,
  InboxMessageDispatcher,
  ProviderStatusListener,
  ConnectionTestResult,
} from '../types.js';

export interface WecomConfig {
  botId: string;
  botSecret: string;
  wsUrl?: string;
}

export class WecomInboxProvider implements InboxProvider<WecomConfig> {
  readonly id = 'wecom';
  readonly displayName = '企业微信智能机器人';

  private client: AiBot.WSClient | null = null;
  private status: InboxProviderStatus = 'disabled';
  private dispatcher: InboxMessageDispatcher | null = null;
  private statusListener: ProviderStatusListener | null = null;
  private seen = new Set<string>();

  getStatus(): InboxProviderStatus {
    return this.status;
  }

  onMessage(dispatcher: InboxMessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  onStatusChange(listener: ProviderStatusListener): void {
    this.statusListener = listener;
  }

  private updateStatus(newStatus: InboxProviderStatus, error?: string): void {
    this.status = newStatus;
    this.statusListener?.(newStatus, error);
  }

  async start(config: WecomConfig): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    if (!config.botId || !config.botSecret) {
      this.updateStatus('error', '缺少 botId 或 botSecret');
      throw new Error('启动企业微信 Provider 失败：必须提供 botId 和 botSecret');
    }

    this.updateStatus('connecting');

    const client = new AiBot.WSClient({
      botId: config.botId,
      secret: config.botSecret,
      wsUrl: config.wsUrl,
      maxReconnectAttempts: 10,
      maxAuthFailureAttempts: 3,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    this.client = client;

    client.on('connected', () => {
      this.updateStatus('connecting');
    });

    client.on('authenticated', () => {
      this.updateStatus('connected');
    });

    client.on('disconnected', (reason: unknown) => {
      this.updateStatus('disconnected', String(reason));
    });

    client.on('reconnecting', () => {
      this.updateStatus('disconnected', '正在重连');
    });

    client.on('error', (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err instanceof WSAuthFailureError) {
        this.updateStatus('auth_failed', err.message);
        // 凭证失效时主动断开连接，避免无限重试
        void this.stop();
      } else if (err instanceof WSReconnectExhaustedError) {
        this.updateStatus('error', '重连次数耗尽');
        void this.stop();
      } else {
        this.updateStatus('error', err.message);
      }
    });

    client.on('event.disconnected_event', () => {
      this.updateStatus('disconnected', '机器人被其他连接接管');
      void this.stop();
    });

    client.on('message', (frame: any) => {
      void this.handleIncomingFrame(frame).catch(() => {});
    });

    client.connect();
  }

  private async handleIncomingFrame(frame: any): Promise<void> {
    const body = frame?.body;
    if (!body?.msgid || !this.dispatcher) return;

    // 内存防重放缓存（最多保留 2000 个近期标识）
    const dedupeKey = JSON.stringify([
      body.aibotid,
      body.chattype,
      body.chatid,
      body.from?.userid,
      body.msgid,
    ]);
    if (this.seen.has(dedupeKey)) return;

    this.seen.add(dedupeKey);
    if (this.seen.size > 2000) {
      const oldest = this.seen.values().next().value;
      if (oldest) this.seen.delete(oldest);
    }

    const text = extractTextContent(body);
    const chatId = body.chatid || null;
    const senderId = body.from?.userid || '';
    const chatType = body.chattype || 'group';
    const msgType = body.msgtype || 'text';

    const event: IncomingInboxEvent = {
      sourceId: this.id,
      sourceEventId: frame.headers?.req_id || body.msgid,
      sourceMessageId: body.msgid,
      revision: 1,
      kind: 'wecom_mention',
      occurredAt: new Date().toISOString(),
      title: chatType === 'group' ? '企业微信群聊 @ 提问' : '企业微信单聊提问',
      summary: text,
      payload: {
        chatId,
        senderId,
        chatType,
        msgType,
        rawText: text,
        rawFrame: frame,
      },
    };

    await this.dispatcher(event);
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // 忽略静默断开异常
      }
      this.client = null;
    }
    this.updateStatus('disabled');
  }

  async testConnection(config: WecomConfig): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    return new Promise((resolve) => {
      let resolved = false;

      const testClient = new AiBot.WSClient({
        botId: config.botId,
        secret: config.botSecret,
        wsUrl: config.wsUrl,
        maxReconnectAttempts: 10,
        maxAuthFailureAttempts: 3,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      });

      const cleanup = () => {
        try {
          testClient.disconnect();
        } catch {}
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            success: false,
            error: '连接握手超时 (5s)',
            latencyMs: Date.now() - startTime,
          });
        }
      }, 5000);

      testClient.on('authenticated', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve({
            success: true,
            message: '企业微信认证成功',
            latencyMs: Date.now() - startTime,
          });
        }
      });

      testClient.on('error', (err: unknown) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve({
            success: false,
            error: err instanceof Error ? err.message : String(err),
            latencyMs: Date.now() - startTime,
          });
        }
      });

      testClient.connect();
    });
  }

  async reply(event: IncomingInboxEvent, text: string): Promise<void> {
    const rawFrame = (event.payload as any)?.rawFrame;
    if (!this.client || !rawFrame) {
      throw new Error('回复失败：当前长连接已关闭或缺少原始消息句柄');
    }

    if (typeof this.client.replyStream === 'function') {
      await this.client.replyStream(rawFrame, generateReqId('stream'), text, true);
    } else {
      throw new Error('当前底层客户端不支持 replyStream 操作');
    }
  }
}

function extractTextContent(body: any): string {
  if (!body) return '';
  if (body.msgtype === 'text' && typeof body.text?.content === 'string') {
    return body.text.content;
  }
  if (body.msgtype === 'voice' && typeof body.voice?.content === 'string') {
    return body.voice.content;
  }
  if (body.msgtype === 'mixed' && Array.isArray(body.mixed?.msg_item)) {
    return body.mixed.msg_item
      .filter((item: any) => item.msgtype === 'text')
      .map((item: any) => item.text?.content || '')
      .join('\n');
  }
  return '';
}
