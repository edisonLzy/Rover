import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  InboxMessageRecord,
  InboxMessageStatus,
  IncomingInboxEvent,
  IngestEventResult,
  ListInboxMessagesOptions,
} from './types.js';

interface RawInboxEventRow {
  id: string;
  source_id: string;
  source_event_id: string;
  received_at: number;
  payload: string;
}

interface RawInboxMessageRow {
  id: string;
  source_id: string;
  source_message_id: string;
  revision: number;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  status: InboxMessageStatus;
  task_id: string | null;
  occurred_at: number;
  created_at: number;
  updated_at: number;
  payload: string | null;
}

function parseMessageRow(row: RawInboxMessageRow): InboxMessageRecord {
  let parsedPayload: Record<string, unknown> | null = null;
  if (row.payload) {
    try {
      parsedPayload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      parsedPayload = null;
    }
  }

  return {
    id: row.id,
    sourceId: row.source_id,
    sourceMessageId: row.source_message_id,
    revision: row.revision,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    url: row.url,
    status: row.status,
    taskId: row.task_id,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload: parsedPayload,
  };
}

export class InboxRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * 原子入库与修订合并流水线
   * 1. 根据 (sourceId, sourceEventId) 做投递事件去重
   * 2. 根据 (sourceId, sourceMessageId) 做业务消息高修订合并
   */
  ingestEvent(event: IncomingInboxEvent): IngestEventResult {
    const tx = this.db.transaction((): IngestEventResult => {
      // 1. 投递事件幂等检查
      const existingEvent = this.db
        .prepare('SELECT id FROM inbox_event WHERE source_id = ? AND source_event_id = ?')
        .get(event.sourceId, event.sourceEventId) as RawInboxEventRow | undefined;

      if (existingEvent) {
        return { applied: false, reason: 'duplicate_event' };
      }

      const now = Date.now();
      const eventId = `inbevt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const eventPayloadStr = JSON.stringify(event.payload ?? {});

      this.db
        .prepare(
          'INSERT INTO inbox_event (id, source_id, source_event_id, received_at, payload) VALUES (?, ?, ?, ?, ?)'
        )
        .run(eventId, event.sourceId, event.sourceEventId, now, eventPayloadStr);

      // 2. 检查既有业务消息投影
      const existingMessage = this.db
        .prepare('SELECT * FROM inbox_message WHERE source_id = ? AND source_message_id = ?')
        .get(event.sourceId, event.sourceMessageId) as RawInboxMessageRow | undefined;

      const incomingRevision = typeof event.revision === 'number' ? event.revision : 1;

      if (existingMessage) {
        // 低修订或同修订不更新消息实体
        if (incomingRevision <= existingMessage.revision) {
          return {
            applied: true,
            isNew: false,
            reason: 'stale_revision',
            message: parseMessageRow(existingMessage),
          };
        }

        // 高修订：合并状态与内容
        let newStatus = existingMessage.status;
        const payloadStatus = (event.payload as Record<string, unknown> | undefined)?.status;
        const isResolvedSignal = payloadStatus === 'resolved' || event.kind === 'resolved';

        if (existingMessage.status === 'resolved') {
          // 已经处于 resolved 终态的消息不可倒退为 unread
          newStatus = 'resolved';
        } else if (isResolvedSignal) {
          newStatus = 'resolved';
        }

        const messagePayloadStr = event.payload ? JSON.stringify(event.payload) : null;

        this.db
          .prepare(
            `UPDATE inbox_message
             SET revision = ?, kind = ?, title = ?, summary = ?, url = ?, status = ?, payload = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            incomingRevision,
            event.kind,
            event.title,
            event.summary ?? null,
            event.url ?? null,
            newStatus,
            messagePayloadStr,
            now,
            existingMessage.id
          );

        const updatedRow = this.db
          .prepare('SELECT * FROM inbox_message WHERE id = ?')
          .get(existingMessage.id) as RawInboxMessageRow;

        return {
          applied: true,
          isNew: false,
          message: parseMessageRow(updatedRow),
        };
      }

      // 3. 全新业务消息入库
      const messageId = `inbox_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const payloadStatus = (event.payload as Record<string, unknown> | undefined)?.status;
      const initialStatus: InboxMessageStatus =
        payloadStatus === 'resolved' || event.kind === 'resolved' ? 'resolved' : 'unread';

      let occurredAt = now;
      if (typeof event.occurredAt === 'number') {
        occurredAt = event.occurredAt;
      } else if (typeof event.occurredAt === 'string') {
        const parsed = Date.parse(event.occurredAt);
        if (!Number.isNaN(parsed)) {
          occurredAt = parsed;
        }
      }

      const messagePayloadStr = event.payload ? JSON.stringify(event.payload) : null;

      this.db
        .prepare(
          `INSERT INTO inbox_message (
            id, source_id, source_message_id, revision, kind, title, summary, url, status,
            task_id, occurred_at, created_at, updated_at, payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
        )
        .run(
          messageId,
          event.sourceId,
          event.sourceMessageId,
          incomingRevision,
          event.kind,
          event.title,
          event.summary ?? null,
          event.url ?? null,
          initialStatus,
          occurredAt,
          now,
          now,
          messagePayloadStr
        );

      const newRow = this.db
        .prepare('SELECT * FROM inbox_message WHERE id = ?')
        .get(messageId) as RawInboxMessageRow;

      return {
        applied: true,
        isNew: true,
        message: parseMessageRow(newRow),
      };
    });
    return tx();
  }

  /**
   * 列表查询（按时间倒序）
   */
  listMessages(options?: ListInboxMessagesOptions): InboxMessageRecord[] {
    let sql = 'SELECT * FROM inbox_message';
    const params: unknown[] = [];

    if (options?.status && options.status !== 'all') {
      sql += ' WHERE status = ?';
      params.push(options.status);
    }

    sql += ' ORDER BY occurred_at DESC, created_at DESC';

    if (typeof options?.limit === 'number' && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (typeof options?.offset === 'number' && options.offset > 0) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as RawInboxMessageRow[];
    return rows.map(parseMessageRow);
  }

  /**
   * 根据本地主键获取单条消息
   */
  getMessageById(id: string): InboxMessageRecord | null {
    const row = this.db.prepare('SELECT * FROM inbox_message WHERE id = ?').get(id) as
      | RawInboxMessageRow
      | undefined;
    return row ? parseMessageRow(row) : null;
  }

  /**
   * 根据来源标识获取单条消息
   */
  getMessageBySource(sourceId: string, sourceMessageId: string): InboxMessageRecord | null {
    const row = this.db
      .prepare('SELECT * FROM inbox_message WHERE source_id = ? AND source_message_id = ?')
      .get(sourceId, sourceMessageId) as RawInboxMessageRow | undefined;
    return row ? parseMessageRow(row) : null;
  }

  /**
   * 统计未读消息总数
   */
  getUnreadCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM inbox_message WHERE status = 'unread'")
      .get() as { count: number };
    return row.count;
  }

  /**
   * 批量将未读消息标记为已读
   */
  markAsRead(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE inbox_message
         SET status = 'read', updated_at = ?
         WHERE id IN (${placeholders}) AND status = 'unread'`
      )
      .run(Date.now(), ...ids);
  }

  /**
   * 将消息推进为已一键交办（delegated）
   * 用户在抽屉点击「交由 Rover 处理」开启回合时调用，此时尚未决定是否派发 Task
   */
  markDelegated(id: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE inbox_message
         SET status = 'delegated', updated_at = ?
         WHERE id = ?`
      )
      .run(Date.now(), id);
    return info.changes > 0;
  }

  /**
   * 将消息推进为已一键交办（delegated）的统一语义别名
   */
  markAsDelegated(id: string): boolean {
    return this.markDelegated(id);
  }

  /**
   * 关联生成的 Task ID
   * 仅在 Rover Agent 决定派发 Code Agent 且成功注册 Task 后调用
   */
  linkTask(id: string, taskId: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE inbox_message
         SET task_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(taskId, Date.now(), id);
    return info.changes > 0;
  }

  /**
   * 删除单条消息
   */
  deleteMessage(id: string): boolean {
    const info = this.db.prepare('DELETE FROM inbox_message WHERE id = ?').run(id);
    return info.changes > 0;
  }
}
