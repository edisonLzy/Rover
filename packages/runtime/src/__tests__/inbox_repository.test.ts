import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  runMigrations,
  type RoverDatabase,
} from '../infrastructure/database/index.js';
import { InboxRepository } from '../modules/inbox/repository.js';
import type { IncomingInboxEvent } from '../modules/inbox/types.js';

describe('InboxRepository & SQLite Storage (Ticket 001)', () => {
  let db: RoverDatabase;
  let repo: InboxRepository;

  beforeEach(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);
    repo = new InboxRepository(db.raw);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('Schema & Migrations', () => {
    it('initializes inbox_event and inbox_message tables correctly', () => {
      const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('inbox_event');
      expect(tableNames).toContain('inbox_message');
    });

    it('enforces unique constraint on inbox_event(source_id, source_event_id)', () => {
      db.raw
        .prepare(
          'INSERT INTO inbox_event (id, source_id, source_event_id, received_at, payload) VALUES (?, ?, ?, ?, ?)'
        )
        .run('e1', 'wecom', 'evt-1', Date.now(), '{}');

      expect(() => {
        db.raw
          .prepare(
            'INSERT INTO inbox_event (id, source_id, source_event_id, received_at, payload) VALUES (?, ?, ?, ?, ?)'
          )
          .run('e2', 'wecom', 'evt-1', Date.now(), '{}');
      }).toThrow(/UNIQUE constraint failed/);
    });

    it('enforces unique constraint on inbox_message(source_id, source_message_id)', () => {
      db.raw
        .prepare(
          `INSERT INTO inbox_message (
            id, source_id, source_message_id, revision, kind, title, status, occurred_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'm1',
          'wecom',
          'msg-1',
          1,
          'wecom_mention',
          'Title',
          'unread',
          Date.now(),
          Date.now(),
          Date.now()
        );

      expect(() => {
        db.raw
          .prepare(
            `INSERT INTO inbox_message (
              id, source_id, source_message_id, revision, kind, title, status, occurred_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            'm2',
            'wecom',
            'msg-1',
            1,
            'wecom_mention',
            'Title 2',
            'unread',
            Date.now(),
            Date.now(),
            Date.now()
          );
      }).toThrow(/UNIQUE constraint failed/);
    });
  });

  describe('ingestEvent (Idempotency & Revision Merging)', () => {
    it('creates a new unread inbox message on first event', () => {
      const event: IncomingInboxEvent = {
        sourceId: 'wecom',
        sourceEventId: 'evt-100',
        sourceMessageId: 'msg-200',
        revision: 1,
        kind: 'wecom_mention',
        title: '用户反馈支付报错',
        summary: '结算页出现 500 异常',
        payload: { chatid: 'chat-1', sender: '张三' },
      };

      const result = repo.ingestEvent(event);

      expect(result.applied).toBe(true);
      expect(result.isNew).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.message!.id).toMatch(/^inbox_/);
      expect(result.message!.sourceId).toBe('wecom');
      expect(result.message!.sourceMessageId).toBe('msg-200');
      expect(result.message!.revision).toBe(1);
      expect(result.message!.status).toBe('unread');
      expect(result.message!.title).toBe('用户反馈支付报错');
      expect(result.message!.summary).toBe('结算页出现 500 异常');
      expect(result.message!.payload).toEqual({ chatid: 'chat-1', sender: '张三' });

      expect(repo.getUnreadCount()).toBe(1);
    });

    it('rejects duplicate event with same sourceId and sourceEventId (idempotent)', () => {
      const event: IncomingInboxEvent = {
        sourceId: 'monitor',
        sourceEventId: 'evt-alert-01',
        sourceMessageId: 'issue-404',
        revision: 1,
        kind: 'alert',
        title: 'CPU 过载告警',
        summary: '当前 CPU 使用率超过 95%',
      };

      const first = repo.ingestEvent(event);
      expect(first.applied).toBe(true);
      expect(first.isNew).toBe(true);

      const duplicate = repo.ingestEvent(event);
      expect(duplicate.applied).toBe(false);
      expect(duplicate.reason).toBe('duplicate_event');

      // Total messages and events remains 1
      expect(repo.listMessages()).toHaveLength(1);
      expect(repo.getUnreadCount()).toBe(1);
    });

    it('updates message when receiving higher revision', () => {
      const initial: IncomingInboxEvent = {
        sourceId: 'monitor',
        sourceEventId: 'evt-1',
        sourceMessageId: 'issue-1',
        revision: 1,
        kind: 'alert',
        title: '告警：内存占用过高',
        summary: '内存 85%',
        payload: { status: 'open' },
      };
      repo.ingestEvent(initial);

      const higherRev: IncomingInboxEvent = {
        sourceId: 'monitor',
        sourceEventId: 'evt-2',
        sourceMessageId: 'issue-1',
        revision: 2,
        kind: 'alert',
        title: '告警：内存占用极度危险',
        summary: '内存 98%',
        payload: { status: 'open', memoryPercent: 98 },
      };

      const result = repo.ingestEvent(higherRev);
      expect(result.applied).toBe(true);
      expect(result.isNew).toBe(false);
      expect(result.message!.revision).toBe(2);
      expect(result.message!.title).toBe('告警：内存占用极度危险');
      expect(result.message!.summary).toBe('内存 98%');
      expect(result.message!.payload).toEqual({ status: 'open', memoryPercent: 98 });

      // Still 1 distinct message
      expect(repo.listMessages()).toHaveLength(1);
    });

    it('does not overwrite message when receiving stale or lower revision', () => {
      repo.ingestEvent({
        sourceId: 'monitor',
        sourceEventId: 'evt-rev2',
        sourceMessageId: 'issue-10',
        revision: 2,
        kind: 'alert',
        title: '修订 2 标题',
      });

      const stale: IncomingInboxEvent = {
        sourceId: 'monitor',
        sourceEventId: 'evt-rev1',
        sourceMessageId: 'issue-10',
        revision: 1,
        kind: 'alert',
        title: '迟到的修订 1 标题',
      };

      const result = repo.ingestEvent(stale);
      expect(result.applied).toBe(true);
      expect(result.isNew).toBe(false);
      expect(result.reason).toBe('stale_revision');
      expect(result.message!.title).toBe('修订 2 标题');
      expect(result.message!.revision).toBe(2);
    });

    it('sets resolved status and prevents regression to unread', () => {
      repo.ingestEvent({
        sourceId: 'monitor',
        sourceEventId: 'evt-open',
        sourceMessageId: 'issue-99',
        revision: 1,
        kind: 'alert',
        title: '服务异常',
        payload: { status: 'open' },
      });
      expect(repo.getUnreadCount()).toBe(1);

      // Resolve via higher revision
      repo.ingestEvent({
        sourceId: 'monitor',
        sourceEventId: 'evt-resolved',
        sourceMessageId: 'issue-99',
        revision: 2,
        kind: 'alert',
        title: '服务异常 (已恢复)',
        payload: { status: 'resolved' },
      });

      const resolvedMsg = repo.getMessageBySource('monitor', 'issue-99');
      expect(resolvedMsg?.status).toBe('resolved');

      // Subsequent revision cannot revert resolved to unread
      repo.ingestEvent({
        sourceId: 'monitor',
        sourceEventId: 'evt-late-open',
        sourceMessageId: 'issue-99',
        revision: 3,
        kind: 'alert',
        title: '服务异常 (尝试重新打开)',
        payload: { status: 'open' },
      });

      const afterMsg = repo.getMessageBySource('monitor', 'issue-99');
      expect(afterMsg?.status).toBe('resolved');
    });
  });

  describe('Queries, State Mutations & Lifecycle', () => {
    beforeEach(() => {
      repo.ingestEvent({
        sourceId: 'wecom',
        sourceEventId: 'e-1',
        sourceMessageId: 'm-1',
        revision: 1,
        kind: 'wecom_mention',
        title: '消息 1',
        occurredAt: 1000,
      });
      repo.ingestEvent({
        sourceId: 'wecom',
        sourceEventId: 'e-2',
        sourceMessageId: 'm-2',
        revision: 1,
        kind: 'wecom_mention',
        title: '消息 2',
        occurredAt: 2000,
      });
      repo.ingestEvent({
        sourceId: 'monitor',
        sourceEventId: 'e-3',
        sourceMessageId: 'm-3',
        revision: 1,
        kind: 'alert',
        title: '告警 3',
        occurredAt: 3000,
      });
    });

    it('lists messages sorted by occurredAt descending', () => {
      const messages = repo.listMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0].title).toBe('告警 3');
      expect(messages[1].title).toBe('消息 2');
      expect(messages[2].title).toBe('消息 1');
    });

    it('supports pagination via limit and offset', () => {
      const p1 = repo.listMessages({ limit: 2, offset: 0 });
      expect(p1).toHaveLength(2);
      expect(p1[0].title).toBe('告警 3');
      expect(p1[1].title).toBe('消息 2');

      const p2 = repo.listMessages({ limit: 2, offset: 2 });
      expect(p2).toHaveLength(1);
      expect(p2[0].title).toBe('消息 1');
    });

    it('marks unread messages as read and updates count', () => {
      expect(repo.getUnreadCount()).toBe(3);

      const [first, second] = repo.listMessages();
      repo.markAsRead([first.id, second.id]);

      expect(repo.getUnreadCount()).toBe(1);

      const updatedFirst = repo.getMessageById(first.id);
      expect(updatedFirst?.status).toBe('read');
    });

    it('marks message as delegated without requiring task_id', () => {
      const [msg] = repo.listMessages();
      const success = repo.markDelegated(msg.id);

      expect(success).toBe(true);

      const delegated = repo.getMessageById(msg.id);
      expect(delegated?.status).toBe('delegated');
      expect(delegated?.taskId).toBeNull();
    });

    it('links task_id with foreign key constraint when task is dispatched', () => {
      const [msg] = repo.listMessages();
      repo.markDelegated(msg.id);

      const taskId = 'task_rover_888';

      // 验证不存在的 taskId 会触发外键约束报错
      expect(() => {
        repo.linkTask(msg.id, 'non_existent_task');
      }).toThrow(/FOREIGN KEY constraint failed/);

      // 插入有效 task 后关联成功
      db.raw
        .prepare(
          `INSERT INTO task (id, goal, agent, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(taskId, '排查线上故障', 'claude', 'running', Date.now(), Date.now());

      const success = repo.linkTask(msg.id, taskId);
      expect(success).toBe(true);

      const linked = repo.getMessageById(msg.id);
      expect(linked?.status).toBe('delegated');
      expect(linked?.taskId).toBe(taskId);
    });

    it('filters messages by status', () => {
      const [first] = repo.listMessages();
      repo.markAsRead([first.id]);

      const unreadList = repo.listMessages({ status: 'unread' });
      expect(unreadList).toHaveLength(2);

      const readList = repo.listMessages({ status: 'read' });
      expect(readList).toHaveLength(1);
      expect(readList[0].id).toBe(first.id);
    });

    it('deletes message by ID', () => {
      const [first] = repo.listMessages();
      const deleted = repo.deleteMessage(first.id);
      expect(deleted).toBe(true);

      expect(repo.getMessageById(first.id)).toBeNull();
      expect(repo.listMessages()).toHaveLength(2);
    });
  });
});
