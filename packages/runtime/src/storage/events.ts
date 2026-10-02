import type Database from 'better-sqlite3';
import type { AppendEventOptions, RuntimeEvent } from './types.js';

interface RawRuntimeEventRow {
  event_seq: number;
  event_type: string;
  payload: string;
  created_at: number;
}

export function appendRuntimeEvent<T = unknown>(
  db: Database.Database,
  options: AppendEventOptions
): RuntimeEvent<T> {
  const { eventType, payload, createdAt = Date.now() } = options;
  const serializedPayload = JSON.stringify(payload);

  const stmt = db.prepare(`
    INSERT INTO runtime_event (event_type, payload, created_at)
    VALUES (?, ?, ?)
  `);

  const info = stmt.run(eventType, serializedPayload, createdAt);
  const eventSeq = Number(info.lastInsertRowid);

  return {
    eventSeq,
    eventType,
    payload: payload as T,
    createdAt,
  };
}

export interface GetEventsOptions {
  afterSeq?: number;
  limit?: number;
}

export function getRuntimeEvents<T = unknown>(
  db: Database.Database,
  options: GetEventsOptions = {}
): RuntimeEvent<T>[] {
  const { afterSeq = 0, limit = 100 } = options;

  const stmt = db.prepare(`
    SELECT event_seq, event_type, payload, created_at
    FROM runtime_event
    WHERE event_seq > ?
    ORDER BY event_seq ASC
    LIMIT ?
  `);

  const rows = stmt.all(afterSeq, limit) as RawRuntimeEventRow[];

  return rows.map((row) => ({
    eventSeq: row.event_seq,
    eventType: row.event_type,
    payload: JSON.parse(row.payload) as T,
    createdAt: row.created_at,
  }));
}

export function getLatestEventSeq(db: Database.Database): number {
  const stmt = db.prepare('SELECT MAX(event_seq) as max_seq FROM runtime_event');
  const row = stmt.get() as { max_seq: number | null } | undefined;
  return row?.max_seq ?? 0;
}
