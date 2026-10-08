import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../infrastructure/database/index.js';
import { InboxRepository } from '../modules/inbox/repository.js';
import { InboxService } from '../modules/inbox/service.js';
import { inboxRouter } from '../modules/inbox/router.js';
import type { Context } from '../trpc/context.js';
import type { Container } from '../container.js';
import type { InboxProvider, IncomingInboxEvent } from '../modules/inbox/types.js';
import type { WecomConfig } from '../modules/inbox/providers/wecom.js';

describe('Inbox tRPC Router (Ticket 004)', () => {
  let tmpDir: string;
  let configPath: string;
  let db: Database.Database;
  let repository: InboxRepository;
  let mockProvider: InboxProvider<WecomConfig>;
  let mockWsManager: any;
  let service: InboxService;
  let ctx: Context;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-inbox-router-test-'));
    configPath = path.join(tmpDir, 'inbox.json');

    db = new Database(':memory:');
    runMigrations(db);
    repository = new InboxRepository(db);

    mockWsManager = {
      broadcast: vi.fn(),
    };

    let currentStatus = 'disabled';
    mockProvider = {
      id: 'wecom',
      displayName: 'Mock 企业微信',
      getStatus: vi.fn(() => currentStatus as any),
      onMessage: vi.fn(),
      onStatusChange: vi.fn(),
      start: vi.fn(async () => {
        currentStatus = 'connected';
      }),
      stop: vi.fn(async () => {
        currentStatus = 'disabled';
      }),
      testConnection: vi.fn(async (cfg) => {
        if (!cfg.botId || !cfg.botSecret) {
          return { success: false, error: '缺少凭证' };
        }
        if (cfg.botSecret === 'bad_secret') {
          return { success: false, error: '认证失败: Invalid Secret' };
        }
        return { success: true, latencyMs: 38 };
      }),
    };

    service = new InboxService({
      repository,
      wsManager: mockWsManager,
      customConfigPath: configPath,
      wecomProvider: mockProvider,
      autoStart: false,
    });

    const mockContainer = {
      inboxService: service,
    } as unknown as Container;

    ctx = {
      req: {} as any,
      res: {} as any,
      token: 'test-token',
      isAuthenticated: true,
      container: mockContainer,
    };
  });

  afterEach(async () => {
    await service.stopAll();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('queries wecom config with masked and unmasked secret', async () => {
    const caller = inboxRouter.createCaller(ctx);

    // Initial default
    const initial = await caller.getWecomConfig();
    expect(initial.enabled).toBe(false);
    expect(initial.status).toBe('disabled');
    expect(initial.botId).toBe('');
    expect(initial.botSecret).toBe('');

    // Update with real secret
    await caller.updateWecomConfig({
      enabled: true,
      botId: 'bot-12345',
      botSecret: 'my_super_secret_token_9999',
    });

    // Query masked (default)
    const masked = await caller.getWecomConfig();
    expect(masked.enabled).toBe(true);
    expect(masked.botId).toBe('bot-12345');
    expect(masked.botSecret).toContain('••••••••');
    expect(masked.botSecret).toContain('9999');

    // Query unmasked (eye toggle)
    const unmasked = await caller.getWecomConfig({ unmask: true });
    expect(unmasked.botSecret).toBe('my_super_secret_token_9999');
  });

  it('tests connection without mutating main connection or throwing', async () => {
    const caller = inboxRouter.createCaller(ctx);

    const failResult = await caller.testWecomConnection({
      botId: 'test-bot',
      botSecret: 'bad_secret',
    });
    expect(failResult.success).toBe(false);
    expect(failResult.error).toContain('Invalid Secret');

    const okResult = await caller.testWecomConnection({
      botId: 'test-bot',
      botSecret: 'valid_secret',
    });
    expect(okResult.success).toBe(true);
    expect(okResult.latencyMs).toBe(38);
  });

  it('supports list, unreadCount, markAsRead, markAsDelegated, and linkTask', async () => {
    const caller = inboxRouter.createCaller(ctx);

    // Ingest events
    const event1: IncomingInboxEvent = {
      sourceId: 'wecom',
      sourceEventId: 'evt-101',
      sourceMessageId: 'msg-001',
      revision: 1,
      kind: 'text',
      title: '线上报警',
      summary: '500 internal server error',
      occurredAt: 1700000000,
    };
    const event2: IncomingInboxEvent = {
      sourceId: 'wecom',
      sourceEventId: 'evt-102',
      sourceMessageId: 'msg-002',
      revision: 1,
      kind: 'text',
      title: '需求提问',
      summary: '怎么使用 Rover?',
      occurredAt: 1700000010,
    };
    await service.handleIncomingEvent(event1);
    await service.handleIncomingEvent(event2);

    // Initial unread count should be 2
    const unreadCount = await caller.getUnreadCount();
    expect(unreadCount).toBe(2);

    // List messages
    const list = await caller.list({ limit: 10 });
    expect(list).toHaveLength(2);

    const msg1 = list.find((m) => m.sourceMessageId === 'msg-001')!;
    const msg2 = list.find((m) => m.sourceMessageId === 'msg-002')!;

    // Mark msg1 as read
    await caller.markAsRead({ ids: [msg1.id] });
    expect(await caller.getUnreadCount()).toBe(1);

    // Mark msg2 as delegated (starts Rover turn, no taskId yet)
    const delegateResult = await caller.markAsDelegated({ id: msg2.id });
    expect(delegateResult.success).toBe(true);

    const updatedList = await caller.list();
    const updatedMsg2 = updatedList.find((m) => m.id === msg2.id)!;
    expect(updatedMsg2.status).toBe('delegated');
    expect(updatedMsg2.taskId).toBeNull();

    // Rover dispatches coding agent and links task
    db.prepare(
      'INSERT INTO task (id, goal, agent, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('task-coding-456', '排查线上报警', 'claude', 'running', Date.now(), Date.now());

    const linkResult = await caller.linkTask({ id: msg2.id, taskId: 'task-coding-456' });
    expect(linkResult.success).toBe(true);

    const finalMsg2 = service.getMessageById(msg2.id)!;
    expect(finalMsg2.taskId).toBe('task-coding-456');
  });
});
