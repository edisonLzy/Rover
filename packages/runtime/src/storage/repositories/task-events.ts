import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { appendRuntimeEvent } from '../events.js';
import type {
  SessionAvailability,
  TaskAgent,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
} from '../types.js';
import type { WebSocketManager } from '../../transport/websocket.js';

interface RawTaskRow {
  id: string;
  goal: string;
  agent: TaskAgent;
  status: TaskStatus;
  progress_text: string | null;
  result_text: string | null;
  created_at: number;
  updated_at: number;
}

interface RawTaskEventRow {
  id: string;
  task_id: string;
  source: string;
  source_event_id: string;
  kind: string;
  observed_at: number;
  summary: string | null;
  evidence_ref: string | null;
}

function parseTaskRow(row: RawTaskRow): TaskRecord {
  return {
    id: row.id,
    goal: row.goal,
    agent: row.agent,
    status: row.status,
    progressText: row.progress_text,
    resultText: row.result_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseTaskEventRow(row: RawTaskEventRow): TaskEventRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    source: row.source,
    sourceEventId: row.source_event_id,
    kind: row.kind,
    observedAt: row.observed_at,
    summary: row.summary,
    evidenceRef: row.evidence_ref,
  };
}

export interface InsertTaskEventInput {
  id?: string;
  taskId: string;
  source: string;
  sourceEventId: string;
  kind: string;
  observedAt?: number;
  summary?: string | null;
  evidenceRef?: string | null;
}

export interface InsertTaskEventResult {
  inserted: boolean;
  event: TaskEventRecord;
}

/**
 * Idempotently inserts a task event, deduping on (task_id, source, source_event_id).
 */
export function insertTaskEvent(
  db: Database.Database,
  input: InsertTaskEventInput
): InsertTaskEventResult {
  const eventId = input.id || `te_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const observedAt = input.observedAt ?? Date.now();

  const stmt = db.prepare(`
    INSERT INTO task_event (
      id, task_id, source, source_event_id, kind, observed_at, summary, evidence_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, source, source_event_id) DO NOTHING
  `);

  const info = stmt.run(
    eventId,
    input.taskId,
    input.source,
    input.sourceEventId,
    input.kind,
    observedAt,
    input.summary ?? null,
    input.evidenceRef ?? null
  );

  if (info.changes > 0) {
    return {
      inserted: true,
      event: {
        id: eventId,
        taskId: input.taskId,
        source: input.source,
        sourceEventId: input.sourceEventId,
        kind: input.kind,
        observedAt,
        summary: input.summary ?? null,
        evidenceRef: input.evidenceRef ?? null,
      },
    };
  }

  // Already existed - fetch and return existing record
  const existingStmt = db.prepare(`
    SELECT id, task_id, source, source_event_id, kind, observed_at, summary, evidence_ref
    FROM task_event
    WHERE task_id = ? AND source = ? AND source_event_id = ?
  `);
  const existingRow = existingStmt.get(input.taskId, input.source, input.sourceEventId) as
    | RawTaskEventRow
    | undefined;

  return {
    inserted: false,
    event: existingRow
      ? parseTaskEventRow(existingRow)
      : {
          id: eventId,
          taskId: input.taskId,
          source: input.source,
          sourceEventId: input.sourceEventId,
          kind: input.kind,
          observedAt,
          summary: input.summary ?? null,
          evidenceRef: input.evidenceRef ?? null,
        },
  };
}

export interface UpdateTaskStatusInput {
  taskId: string;
  status: TaskStatus;
  progressText?: string | null;
  resultText?: string | null;
  updatedAt?: number;
  wsManager?: WebSocketManager;
}

/**
 * Updates task lifecycle status and broadcasts task.changed runtime event.
 */
export function updateTaskStatus(
  db: Database.Database,
  input: UpdateTaskStatusInput
): TaskRecord | null {
  const now = input.updatedAt ?? Date.now();

  const currentStmt = db.prepare(`
    SELECT id, goal, agent, status, progress_text, result_text, created_at, updated_at
    FROM task
    WHERE id = ?
  `);
  const current = currentStmt.get(input.taskId) as RawTaskRow | undefined;
  if (!current) {
    return null;
  }

  const newProgress =
    input.progressText !== undefined ? input.progressText : current.progress_text;
  const newResult = input.resultText !== undefined ? input.resultText : current.result_text;

  const updateStmt = db.prepare(`
    UPDATE task
    SET status = ?,
        progress_text = ?,
        result_text = ?,
        updated_at = ?
    WHERE id = ?
  `);
  updateStmt.run(input.status, newProgress, newResult, now, input.taskId);

  const updatedRecord: TaskRecord = {
    id: current.id,
    goal: current.goal,
    agent: current.agent,
    status: input.status,
    progressText: newProgress,
    resultText: newResult,
    createdAt: current.created_at,
    updatedAt: now,
  };

  // Append runtime_event and broadcast via WebSocket
  const payload = {
    taskId: updatedRecord.id,
    goal: updatedRecord.goal,
    agent: updatedRecord.agent,
    status: updatedRecord.status,
    progressText: updatedRecord.progressText,
    resultText: updatedRecord.resultText,
    updatedAt: now,
  };

  appendRuntimeEvent(db, {
    eventType: 'task.changed',
    payload,
    createdAt: now,
  });

  if (input.wsManager) {
    input.wsManager.broadcast({
      type: 'task.changed',
      payload,
    });
  }

  return updatedRecord;
}

/**
 * Updates session_ref carrier availability (e.g. available -> unavailable when carrier exits).
 */
export function updateSessionRefAvailability(
  db: Database.Database,
  taskId: string,
  availability: SessionAvailability,
  lastSeen?: number
): void {
  const now = lastSeen ?? Date.now();
  const stmt = db.prepare(`
    UPDATE session_ref
    SET availability = ?,
        last_seen = ?
    WHERE task_id = ?
  `);
  stmt.run(availability, now, taskId);
}

/**
 * Looks up task associated with a native session ID and agent type.
 */
export function findTaskByNativeSessionId(
  db: Database.Database,
  agent: TaskAgent,
  nativeSessionId: string
): TaskRecord | null {
  const stmt = db.prepare(`
    SELECT t.id, t.goal, t.agent, t.status, t.progress_text, t.result_text, t.created_at, t.updated_at
    FROM session_ref s
    JOIN task t ON t.id = s.task_id
    WHERE s.agent = ? AND s.native_session_id = ?
  `);
  const row = stmt.get(agent, nativeSessionId) as RawTaskRow | undefined;
  return row ? parseTaskRow(row) : null;
}

/**
 * Looks up task associated with a dispatch attempt ID.
 */
export function findTaskByAttemptId(
  db: Database.Database,
  attemptId: string
): TaskRecord | null {
  const stmt = db.prepare(`
    SELECT t.id, t.goal, t.agent, t.status, t.progress_text, t.result_text, t.created_at, t.updated_at
    FROM dispatch_attempt d
    JOIN task t ON t.id = d.candidate_task_id
    WHERE d.id = ?
  `);
  const row = stmt.get(attemptId) as RawTaskRow | undefined;
  return row ? parseTaskRow(row) : null;
}
