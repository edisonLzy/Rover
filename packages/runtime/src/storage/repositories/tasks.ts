import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { appendRuntimeEvent } from '../events.js';
import type {
  DispatchAttemptDbStatus,
  DispatchAttemptRecord,
  SessionRefRecord,
  TaskAgent,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
} from '../types.js';
import type { WebSocketManager } from '../../transport/websocket.js';

interface RawDispatchAttemptRow {
  id: string;
  candidate_task_id: string;
  source_kind: 'turn' | 'plan' | 'inbox';
  source_id: string;
  agent: TaskAgent;
  cwd: string;
  status: DispatchAttemptDbStatus;
  native_session_id: string | null;
  report_token_hash: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

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

interface RawSessionRefRow {
  task_id: string;
  agent: TaskAgent;
  native_session_id: string;
  config_dir: string;
  carrier_kind: string;
  carrier_name: string;
  availability: 'available' | 'unavailable';
  last_seen: number;
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

function parseDispatchAttemptRow(row: RawDispatchAttemptRow): DispatchAttemptRecord {
  return {
    id: row.id,
    candidateTaskId: row.candidate_task_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    agent: row.agent,
    cwd: row.cwd,
    status: row.status,
    nativeSessionId: row.native_session_id,
    reportTokenHash: row.report_token_hash,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function parseSessionRefRow(row: RawSessionRefRow): SessionRefRecord {
  return {
    taskId: row.task_id,
    agent: row.agent,
    nativeSessionId: row.native_session_id,
    configDir: row.config_dir,
    carrierKind: row.carrier_kind,
    carrierName: row.carrier_name,
    availability: row.availability,
    lastSeen: row.last_seen,
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

export interface InsertDispatchAttemptInput {
  id: string;
  candidateTaskId: string;
  sourceKind: 'turn' | 'plan' | 'inbox';
  sourceId: string;
  agent: TaskAgent;
  cwd: string;
  reportToken: string;
  status?: DispatchAttemptDbStatus;
  nativeSessionId?: string | null;
  error?: string | null;
  createdAt?: number;
}

export function insertDispatchAttempt(
  db: Database.Database,
  input: InsertDispatchAttemptInput
): DispatchAttemptRecord {
  const now = input.createdAt ?? Date.now();
  const status: DispatchAttemptDbStatus = input.status ?? 'starting';
  const reportTokenHash = crypto.createHash('sha256').update(input.reportToken).digest('hex');

  const stmt = db.prepare(`
    INSERT INTO dispatch_attempt (
      id, candidate_task_id, source_kind, source_id, agent, cwd, status,
      native_session_id, report_token_hash, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    input.id,
    input.candidateTaskId,
    input.sourceKind,
    input.sourceId,
    input.agent,
    input.cwd,
    status,
    input.nativeSessionId ?? null,
    reportTokenHash,
    input.error ?? null,
    now,
    now
  );

  return {
    id: input.id,
    candidateTaskId: input.candidateTaskId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    agent: input.agent,
    cwd: input.cwd,
    status,
    nativeSessionId: input.nativeSessionId ?? null,
    reportTokenHash,
    error: input.error ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateDispatchAttemptStatus(
  db: Database.Database,
  attemptId: string,
  status: DispatchAttemptDbStatus,
  error?: string | null,
  nativeSessionId?: string | null
): void {
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE dispatch_attempt
    SET status = ?,
        error = COALESCE(?, error),
        native_session_id = COALESCE(?, native_session_id),
        updated_at = ?
    WHERE id = ?
  `);
  stmt.run(status, error ?? null, nativeSessionId ?? null, now, attemptId);
}

export function getDispatchAttempt(
  db: Database.Database,
  attemptId: string
): DispatchAttemptRecord | null {
  const stmt = db.prepare(`
    SELECT id, candidate_task_id, source_kind, source_id, agent, cwd, status,
           native_session_id, report_token_hash, error, created_at, updated_at
    FROM dispatch_attempt
    WHERE id = ?
  `);
  const row = stmt.get(attemptId) as RawDispatchAttemptRow | undefined;
  return row ? parseDispatchAttemptRow(row) : null;
}

export interface CommitTaskWithSessionParams {
  attemptId: string;
  taskId: string;
  goal: string;
  agent: TaskAgent;
  nativeSessionId: string;
  configDir: string;
  carrierName: string;
  carrierKind?: string;
  wsManager?: WebSocketManager;
  initialEventSummary?: string;
  createdAt?: number;
}

/**
 * Executes single atomic transaction to create Task and SessionRef.
 * Strictly guarantees that empty Tasks are NEVER created without authoritative native session confirmation.
 */
export function commitTaskWithSession(
  db: Database.Database,
  params: CommitTaskWithSessionParams
): { task: TaskRecord; sessionRef: SessionRefRecord } {
  const {
    attemptId,
    taskId,
    goal,
    agent,
    nativeSessionId,
    configDir,
    carrierName,
    carrierKind = 'screen',
    wsManager,
    initialEventSummary = 'Task dispatched and session confirmed',
    createdAt = Date.now(),
  } = params;

  return db.transaction(() => {
    // 1. Insert task first (parent table for foreign keys)
    const taskStmt = db.prepare(`
      INSERT INTO task (
        id, goal, agent, status, progress_text, result_text, created_at, updated_at
      ) VALUES (?, ?, ?, 'running', ?, NULL, ?, ?)
    `);
    taskStmt.run(taskId, goal, agent, initialEventSummary, createdAt, createdAt);

    // 2. Insert session_ref (references task.id)
    const sessionStmt = db.prepare(`
      INSERT INTO session_ref (
        task_id, agent, native_session_id, config_dir, carrier_kind, carrier_name, availability, last_seen
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', ?)
    `);
    sessionStmt.run(
      taskId,
      agent,
      nativeSessionId,
      configDir,
      carrierKind,
      carrierName,
      createdAt
    );

    // 3. Insert initial task_event
    const eventId = `te_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const eventStmt = db.prepare(`
      INSERT INTO task_event (
        id, task_id, source, source_event_id, kind, observed_at, summary, evidence_ref
      ) VALUES (?, ?, ?, ?, 'dispatched', ?, ?, NULL)
    `);
    eventStmt.run(
      eventId,
      taskId,
      agent,
      `init_${attemptId}`,
      createdAt,
      initialEventSummary
    );

    // 4. Advance dispatch_attempt status to 'registered'
    const attemptStmt = db.prepare(`
      UPDATE dispatch_attempt
      SET status = 'registered',
          native_session_id = ?,
          updated_at = ?
      WHERE id = ?
    `);
    attemptStmt.run(nativeSessionId, createdAt, attemptId);

    // 5. Append runtime_event
    const payload = {
      taskId,
      goal,
      agent,
      status: 'running' as TaskStatus,
      nativeSessionId,
      carrierName,
      carrierKind,
      createdAt,
    };

    appendRuntimeEvent(db, {
      eventType: 'task.changed',
      payload,
      createdAt,
    });

    if (wsManager) {
      wsManager.broadcast({
        type: 'task.changed',
        payload,
      });
    }

    const task: TaskRecord = {
      id: taskId,
      goal,
      agent,
      status: 'running',
      progressText: initialEventSummary,
      resultText: null,
      createdAt,
      updatedAt: createdAt,
    };

    const sessionRef: SessionRefRecord = {
      taskId,
      agent,
      nativeSessionId,
      configDir,
      carrierKind,
      carrierName,
      availability: 'available',
      lastSeen: createdAt,
    };

    return { task, sessionRef };
  })();
}

export function getTask(db: Database.Database, taskId: string): TaskRecord | null {
  const stmt = db.prepare(`
    SELECT id, goal, agent, status, progress_text, result_text, created_at, updated_at
    FROM task
    WHERE id = ?
  `);
  const row = stmt.get(taskId) as RawTaskRow | undefined;
  return row ? parseTaskRow(row) : null;
}

export interface ListTasksOptions {
  limit?: number;
  status?: TaskStatus;
}

export function listTasks(
  db: Database.Database,
  options: ListTasksOptions = {}
): TaskRecord[] {
  const { limit = 100, status } = options;

  let query = `
    SELECT id, goal, agent, status, progress_text, result_text, created_at, updated_at
    FROM task
  `;
  const params: unknown[] = [];

  if (status) {
    query += ` WHERE status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as RawTaskRow[];
  return rows.map(parseTaskRow);
}

export function getSessionRef(
  db: Database.Database,
  taskId: string
): SessionRefRecord | null {
  const stmt = db.prepare(`
    SELECT task_id, agent, native_session_id, config_dir, carrier_kind, carrier_name, availability, last_seen
    FROM session_ref
    WHERE task_id = ?
  `);
  const row = stmt.get(taskId) as RawSessionRefRow | undefined;
  return row ? parseSessionRefRow(row) : null;
}

export function listTaskEvents(
  db: Database.Database,
  taskId: string
): TaskEventRecord[] {
  const stmt = db.prepare(`
    SELECT id, task_id, source, source_event_id, kind, observed_at, summary, evidence_ref
    FROM task_event
    WHERE task_id = ?
    ORDER BY observed_at ASC
  `);
  const rows = stmt.all(taskId) as RawTaskEventRow[];
  return rows.map(parseTaskEventRow);
}
