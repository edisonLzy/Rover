import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openDatabase,
  runMigrations,
  type RoverDatabase,
} from '../infrastructure/database/index.js';
import {
  getInboxConfigPath,
  loadInboxConfig,
  maskSecret,
  maskWecomConfig,
  saveInboxConfig,
} from '../modules/inbox/config.js';
import { InboxRepository } from '../modules/inbox/repository.js';
import { InboxService } from '../modules/inbox/service.js';
import type {
  InboxMessageDispatcher,
  InboxProvider,
  InboxProviderStatus,
  IncomingInboxEvent,
  ProviderStatusListener,
} from '../modules/inbox/types.js';
import type { WecomConfig } from '../modules/inbox/providers/wecom.js';
import type { WebSocketManager } from '../transport/websocket.js';

class MockInboxProvider implements InboxProvider<WecomConfig> {
  readonly id = 'wecom';
  readonly displayName = '企业微信智能机器人 (Mock)';
  status: InboxProviderStatus = 'disabled';
  dispatcher: InboxMessageDispatcher | null = null;
  statusListener: ProviderStatusListener | null = null;

  start = vi.fn(async (_config: WecomConfig) => {
    this.status = 'connected';
    this.statusListener?.('connected');
  });

  stop = vi.fn(async () => {
    this.status = 'disabled';
    this.statusListener?.('disabled');
  });

  getStatus = vi.fn(() => this.status);

  onMessage(dispatcher: InboxMessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  onStatusChange(listener: ProviderStatusListener): void {
    this.statusListener = listener;
  }

  testConnection = vi.fn(async () => ({
    success: true,
    message: '测试探针连接成功',
    latencyMs: 15,
  }));
}

describe('InboxService & Configuration Lifecycle (Ticket 003)', () => {
  let tempDir: string;
  let configPath: string;
  let db: RoverDatabase;
  let repo: InboxRepository;
  let mockProvider: MockInboxProvider;
  let mockWsManager: { broadcast: ReturnType<typeof vi.fn> };
  let service: InboxService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-inbox-test-'));
    configPath = path.join(tempDir, 'inbox.json');

    db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);
    repo = new InboxRepository(db.raw);

    mockProvider = new MockInboxProvider();
    mockWsManager = {
      broadcast: vi.fn(),
    };

    service = new InboxService({
      repository: repo,
      wsManager: mockWsManager as unknown as WebSocketManager,
      customConfigPath: configPath,
      wecomProvider: mockProvider,
      autoStart: false,
    });
  });

  afterEach(async () => {
    await service.stopAll();
    db.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Configuration Persistence & Secret Masking', () => {
    it('creates default inbox config file if not present', () => {
      const config = loadInboxConfig(configPath);
      expect(config.version).toBe(1);
      expect(config.wecom.enabled).toBe(false);
      expect(config.wecom.botId).toBe('');
      expect(config.wecom.botSecret).toBe('');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('masks secrets securely without leaking full plaintext', () => {
      expect(maskSecret('')).toBe('');
      expect(maskSecret('12345678')).toBe('••••••••');
      expect(maskSecret('sec_12345678_long_secret')).toBe('sec_••••••••cret');

      const masked = maskWecomConfig({
        enabled: true,
        botId: 'bot_001',
        botSecret: 'my_super_secret_token_123',
      });
      expect(masked.botSecret).toBe('my_s••••••••_123');
      expect(masked.hasSecret).toBe(true);
      expect(masked.isMasked).toBe(true);
    });

    it('respects ROVER_INBOX_CONFIG_PATH environment variable', () => {
      const originalEnv = process.env.ROVER_INBOX_CONFIG_PATH;
      try {
        process.env.ROVER_INBOX_CONFIG_PATH = '/custom/path/inbox.json';
        expect(getInboxConfigPath()).toBe('/custom/path/inbox.json');
      } finally {
        process.env.ROVER_INBOX_CONFIG_PATH = originalEnv;
      }
    });

    it('supports retrieving raw secret when unmask: true', () => {
      saveInboxConfig(
        {
          version: 1,
          wecom: {
            enabled: true,
            botId: 'test_bot',
            botSecret: 'real_plain_secret_999',
          },
        },
        configPath
      );

      const masked = service.getWecomConfig();
      expect(masked.botSecret).not.toBe('real_plain_secret_999');
      expect(masked.botSecret).toContain('••••');

      const unmasked = service.getWecomConfig({ unmask: true });
      expect(unmasked.botSecret).toBe('real_plain_secret_999');
    });
  });

  describe('Dynamic Toggle & Provider Lifecycle', () => {
    it('starts provider when enabling with valid credentials', async () => {
      await service.applyWecomConfig({
        enabled: true,
        botId: 'bot_wecom_88',
        botSecret: 'secret_abc123',
      });

      expect(mockProvider.start).toHaveBeenCalledWith({
        botId: 'bot_wecom_88',
        botSecret: 'secret_abc123',
        wsUrl: undefined,
      });
      expect(service.getProviderStatus('wecom')).toBe('connected');

      // 验证落盘保存
      const saved = loadInboxConfig(configPath);
      expect(saved.wecom.enabled).toBe(true);
      expect(saved.wecom.botId).toBe('bot_wecom_88');
      expect(saved.wecom.botSecret).toBe('secret_abc123');
    });

    it('stops provider when disabling', async () => {
      await service.applyWecomConfig({
        enabled: true,
        botId: 'bot_1',
        botSecret: 'sec_1',
      });
      expect(service.getProviderStatus('wecom')).toBe('connected');

      await service.applyWecomConfig({ enabled: false });
      expect(mockProvider.stop).toHaveBeenCalled();
      expect(service.getProviderStatus('wecom')).toBe('disabled');
    });

    it('preserves existing secret when patch submits masked placeholder', async () => {
      await service.applyWecomConfig({
        enabled: true,
        botId: 'bot_1',
        botSecret: 'original_super_secret',
      });

      // 模拟前端表单提交：密钥未修改，传回了掩码
      await service.applyWecomConfig({
        enabled: true,
        botId: 'bot_modified',
        botSecret: 'orig••••••••cret',
      });

      const saved = loadInboxConfig(configPath);
      expect(saved.wecom.botId).toBe('bot_modified');
      expect(saved.wecom.botSecret).toBe('original_super_secret');
    });

    it('auto-starts enabled provider during init()', async () => {
      saveInboxConfig(
        {
          version: 1,
          wecom: {
            enabled: true,
            botId: 'auto_bot',
            botSecret: 'auto_secret',
          },
        },
        configPath
      );

      const autoService = new InboxService({
        repository: repo,
        customConfigPath: configPath,
        wecomProvider: mockProvider,
        autoStart: false,
      });

      await autoService.init();
      expect(mockProvider.start).toHaveBeenCalledWith({
        botId: 'auto_bot',
        botSecret: 'auto_secret',
        wsUrl: undefined,
      });
      await autoService.stopAll();
    });

    it('gracefully handles stopAll() for all registered providers', async () => {
      await service.applyWecomConfig({
        enabled: true,
        botId: 'b',
        botSecret: 's',
      });
      await service.stopAll();
      expect(mockProvider.stop).toHaveBeenCalled();
    });
  });

  describe('Event Ingestion & WebSocket Broadcast Pipeline', () => {
    it('ingests event from provider dispatcher and broadcasts inbox.changed', async () => {
      expect(mockProvider.dispatcher).toBeDefined();

      const incomingEvent: IncomingInboxEvent = {
        sourceId: 'wecom',
        sourceEventId: 'evt_101',
        sourceMessageId: 'msg_202',
        revision: 1,
        kind: 'wecom_mention',
        title: '生产环境网关 502 报警',
        summary: '接口响应严重超时',
        payload: { chatId: 'wrk_01', senderId: 'ops_lead' },
      };

      await mockProvider.dispatcher!(incomingEvent);

      // 1. 验证 SQLite 数据已持久化
      const messages = service.listMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].title).toBe('生产环境网关 502 报警');
      expect(messages[0].status).toBe('unread');
      expect(service.getUnreadCount()).toBe(1);

      // 2. 验证触发了 WebSocket 广播通知桌面端
      expect(mockWsManager.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inbox.changed',
          payload: expect.objectContaining({
            unreadCount: 1,
            message: expect.objectContaining({
              sourceMessageId: 'msg_202',
              title: '生产环境网关 502 报警',
            }),
          }),
        })
      );
    });

    it('does not broadcast for duplicate events', async () => {
      const incomingEvent: IncomingInboxEvent = {
        sourceId: 'wecom',
        sourceEventId: 'evt_same',
        sourceMessageId: 'msg_same',
        kind: 'wecom_mention',
        title: '重复事件',
      };

      await mockProvider.dispatcher!(incomingEvent);
      expect(mockWsManager.broadcast).toHaveBeenCalledTimes(1);

      // 第二次重复写入，幂等去重
      await mockProvider.dispatcher!(incomingEvent);
      // 仍然只有第一次广播
      expect(mockWsManager.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('Queries, State Operations & Connection Probe', () => {
    beforeEach(async () => {
      await service.handleIncomingEvent({
        sourceId: 'wecom',
        sourceEventId: 'e1',
        sourceMessageId: 'm1',
        kind: 'wecom_mention',
        title: '消息 1',
      });
      await service.handleIncomingEvent({
        sourceId: 'wecom',
        sourceEventId: 'e2',
        sourceMessageId: 'm2',
        kind: 'wecom_mention',
        title: '消息 2',
      });
    });

    it('marks messages as read and broadcasts inbox.changed', () => {
      const [first] = service.listMessages();
      mockWsManager.broadcast.mockClear();

      service.markAsRead([first.id]);

      expect(service.getUnreadCount()).toBe(1);
      expect(mockWsManager.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inbox.changed',
          payload: expect.objectContaining({
            unreadCount: 1,
            type: 'status_updated',
          }),
        })
      );
    });

    it('marks message as delegated and broadcasts change', () => {
      const [first] = service.listMessages();
      mockWsManager.broadcast.mockClear();

      const success = service.markAsDelegated(first.id);
      expect(success).toBe(true);

      const updated = service.getMessageById(first.id);
      expect(updated?.status).toBe('delegated');
      expect(updated?.taskId).toBeNull();

      expect(mockWsManager.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inbox.changed',
          payload: expect.objectContaining({
            type: 'status_updated',
            messageId: first.id,
          }),
        })
      );
    });

    it('links taskId when task is dispatched', () => {
      const [first] = service.listMessages();
      service.markAsDelegated(first.id);

      // 插入外键关联所需的 task 实体
      db.raw
        .prepare(
          `INSERT INTO task (id, goal, agent, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run('task_dispatch_1', '排查告警', 'claude', 'running', Date.now(), Date.now());

      mockWsManager.broadcast.mockClear();
      const success = service.linkTask(first.id, 'task_dispatch_1');
      expect(success).toBe(true);

      const linked = service.getMessageById(first.id);
      expect(linked?.taskId).toBe('task_dispatch_1');

      expect(mockWsManager.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inbox.changed',
          payload: expect.objectContaining({
            type: 'task_linked',
            messageId: first.id,
            taskId: 'task_dispatch_1',
          }),
        })
      );
    });

    it('delegates testWecomConnection to provider probe', async () => {
      saveInboxConfig(
        {
          version: 1,
          wecom: {
            enabled: true,
            botId: 'saved_bot',
            botSecret: 'saved_secret',
          },
        },
        configPath
      );

      const result = await service.testWecomConnection();
      expect(result.success).toBe(true);
      expect(mockProvider.testConnection).toHaveBeenCalledWith({
        botId: 'saved_bot',
        botSecret: 'saved_secret',
        wsUrl: undefined,
      });
    });
  });
});
