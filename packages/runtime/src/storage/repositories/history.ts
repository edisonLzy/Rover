import type Database from 'better-sqlite3';
import { appendRuntimeEvent } from '../events.js';
import type {
  AgentMessage,
  CompactionPayload,
  EffectiveHistory,
  RoverEntryRecord,
  RoverTurnRecord,
  RoverTurnStatus,
} from '../types.js';

interface RawEntryRow {
  seq: number;
  id: string;
  turn_id: string | null;
  type: 'message' | 'compaction';
  schema_version: number;
  data: string;
  created_at: number;
}

interface RawTurnRow {
  id: string;
  status: RoverTurnStatus;
  prompt_doc: string;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

function parseEntryRow<T = AgentMessage | CompactionPayload>(
  row: RawEntryRow
): RoverEntryRecord<T> {
  return {
    seq: row.seq,
    id: row.id,
    turnId: row.turn_id,
    type: row.type,
    schemaVersion: row.schema_version,
    data: JSON.parse(row.data) as T,
    createdAt: row.created_at,
  };
}

function parseTurnRow(row: RawTurnRow): RoverTurnRecord {
  return {
    id: row.id,
    status: row.status,
    promptDoc: JSON.parse(row.prompt_doc) as Record<string, unknown>,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export interface CreateTurnInput {
  id: string;
  promptDoc: Record<string, unknown>;
  createdAt?: number;
}

export function createRoverTurn(db: Database.Database, input: CreateTurnInput): RoverTurnRecord {
  const { id, promptDoc, createdAt = Date.now() } = input;
  const promptDocJson = JSON.stringify(promptDoc);

  const existing = getRoverTurn(db, id);
  if (existing) {
    if (JSON.stringify(existing.promptDoc) === promptDocJson) {
      return existing;
    }
    throw new Error(`Conflict: Rover turn with ID "${id}" already exists with different content`);
  }

  const stmt = db.prepare(`
    INSERT INTO rover_turn (id, status, prompt_doc, created_at)
    VALUES (?, 'running', ?, ?)
  `);

  stmt.run(id, promptDocJson, createdAt);

  const record: RoverTurnRecord = {
    id,
    status: 'running',
    promptDoc,
    error: null,
    createdAt,
    completedAt: null,
  };

  appendRuntimeEvent(db, {
    eventType: 'turn.started',
    payload: { turnId: id, createdAt },
    createdAt,
  });

  return record;
}

export interface UpdateTurnStatusInput {
  id: string;
  status: RoverTurnStatus;
  error?: string | null;
  completedAt?: number;
}

export function updateRoverTurnStatus(
  db: Database.Database,
  input: UpdateTurnStatusInput
): RoverTurnRecord {
  const { id, status, error = null, completedAt = Date.now() } = input;
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  const effectiveCompletedAt = isTerminal ? completedAt : null;

  const stmt = db.prepare(`
    UPDATE rover_turn
    SET status = ?, error = ?, completed_at = ?
    WHERE id = ?
  `);

  const info = stmt.run(status, error, effectiveCompletedAt, id);
  if (info.changes === 0) {
    throw new Error(`Rover turn with ID "${id}" not found`);
  }

  const updated = getRoverTurn(db, id);
  if (!updated) {
    throw new Error(`Failed to load updated turn "${id}"`);
  }

  appendRuntimeEvent(db, {
    eventType: 'turn.status_changed',
    payload: { turnId: id, status, error, completedAt: effectiveCompletedAt },
    createdAt: Date.now(),
  });

  return updated;
}

export function getRoverTurn(db: Database.Database, id: string): RoverTurnRecord | null {
  const stmt = db.prepare('SELECT * FROM rover_turn WHERE id = ?');
  const row = stmt.get(id) as RawTurnRow | undefined;
  return row ? parseTurnRow(row) : null;
}

export interface AppendMessageEntryInput {
  id: string;
  turnId: string;
  message: AgentMessage;
  schemaVersion?: number;
  createdAt?: number;
}

export function appendMessageEntry(
  db: Database.Database,
  input: AppendMessageEntryInput
): RoverEntryRecord<AgentMessage> {
  const { id, turnId, message, schemaVersion = 1, createdAt = Date.now() } = input;
  const serializedData = JSON.stringify(message);

  // Check for idempotency and content conflict
  const existing = getEntryById(db, id);
  if (existing) {
    if (
      existing.type === 'message' &&
      existing.turnId === turnId &&
      JSON.stringify(existing.data) === serializedData
    ) {
      return existing as RoverEntryRecord<AgentMessage>;
    }
    throw new Error(`Conflict: Message entry with ID "${id}" already exists with conflicting data`);
  }

  const stmt = db.prepare(`
    INSERT INTO rover_entry (id, turn_id, type, schema_version, data, created_at)
    VALUES (?, ?, 'message', ?, ?, ?)
  `);

  const info = stmt.run(id, turnId, schemaVersion, serializedData, createdAt);
  const seq = Number(info.lastInsertRowid);

  const record: RoverEntryRecord<AgentMessage> = {
    seq,
    id,
    turnId,
    type: 'message',
    schemaVersion,
    data: message,
    createdAt,
  };

  appendRuntimeEvent(db, {
    eventType: 'rover.entry.appended',
    payload: record,
    createdAt,
  });

  return record;
}

export interface AppendCompactionEntryInput {
  id: string;
  compaction: CompactionPayload;
  schemaVersion?: number;
  createdAt?: number;
}

export function appendCompactionEntry(
  db: Database.Database,
  input: AppendCompactionEntryInput
): RoverEntryRecord<CompactionPayload> {
  const { id, compaction, schemaVersion = 1, createdAt = Date.now() } = input;
  const serializedData = JSON.stringify(compaction);

  // Check for idempotency
  const existing = getEntryById(db, id);
  if (existing) {
    if (existing.type === 'compaction' && JSON.stringify(existing.data) === serializedData) {
      return existing as RoverEntryRecord<CompactionPayload>;
    }
    throw new Error(
      `Conflict: Compaction entry with ID "${id}" already exists with conflicting data`
    );
  }

  // Invariants check: coveredThroughSeq must be a valid existing entry seq
  const coveredEntryStmt = db.prepare('SELECT seq FROM rover_entry WHERE seq = ?');
  const coveredEntry = coveredEntryStmt.get(compaction.coveredThroughSeq) as
    | { seq: number }
    | undefined;
  if (!coveredEntry) {
    throw new Error(
      `Invalid compaction: coveredThroughSeq ${compaction.coveredThroughSeq} does not exist`
    );
  }

  // Validate previous compaction link if present
  if (compaction.previousCompactionId) {
    const prev = getEntryById(db, compaction.previousCompactionId);
    if (!prev || prev.type !== 'compaction') {
      throw new Error(
        `Invalid previousCompactionId "${compaction.previousCompactionId}": not found or not a compaction`
      );
    }
    const prevPayload = prev.data as CompactionPayload;
    if (compaction.coveredThroughSeq <= prevPayload.coveredThroughSeq) {
      throw new Error(
        `Invalid compaction: coveredThroughSeq (${compaction.coveredThroughSeq}) must be strictly greater than previous (${prevPayload.coveredThroughSeq})`
      );
    }
  }

  const stmt = db.prepare(`
    INSERT INTO rover_entry (id, turn_id, type, schema_version, data, created_at)
    VALUES (?, NULL, 'compaction', ?, ?, ?)
  `);

  const info = stmt.run(id, schemaVersion, serializedData, createdAt);
  const seq = Number(info.lastInsertRowid);

  const record: RoverEntryRecord<CompactionPayload> = {
    seq,
    id,
    turnId: null,
    type: 'compaction',
    schemaVersion,
    data: compaction,
    createdAt,
  };

  appendRuntimeEvent(db, {
    eventType: 'rover.compaction.appended',
    payload: record,
    createdAt,
  });

  return record;
}

export function getLatestCompaction(
  db: Database.Database
): RoverEntryRecord<CompactionPayload> | null {
  const stmt = db.prepare(`
    SELECT * FROM rover_entry
    WHERE type = 'compaction'
    ORDER BY seq DESC
    LIMIT 1
  `);
  const row = stmt.get() as RawEntryRow | undefined;
  return row ? parseEntryRow<CompactionPayload>(row) : null;
}

export function getEffectiveHistory(db: Database.Database): EffectiveHistory {
  // Read latest compaction and raw message suffix inside a consistent read transaction
  const latestCompaction = getLatestCompaction(db);
  const coveredSeq = latestCompaction ? latestCompaction.data.coveredThroughSeq : 0;

  const stmt = db.prepare(`
    SELECT * FROM rover_entry
    WHERE type = 'message' AND seq > ?
    ORDER BY seq ASC
  `);

  const rows = stmt.all(coveredSeq) as RawEntryRow[];
  const messages = rows.map((r) => parseEntryRow<AgentMessage>(r));

  const maxSeqStmt = db.prepare('SELECT MAX(seq) as max_seq FROM rover_entry');
  const maxSeqRow = maxSeqStmt.get() as { max_seq: number | null } | undefined;
  const latestSeq = maxSeqRow?.max_seq ?? 0;

  return {
    compaction: latestCompaction,
    messages,
    latestSeq,
  };
}

export function getTurnEntries(
  db: Database.Database,
  turnId: string
): RoverEntryRecord<AgentMessage>[] {
  const stmt = db.prepare(`
    SELECT * FROM rover_entry
    WHERE turn_id = ? AND type = 'message'
    ORDER BY seq ASC
  `);
  const rows = stmt.all(turnId) as RawEntryRow[];
  return rows.map((r) => parseEntryRow<AgentMessage>(r));
}

export function getEntryById(db: Database.Database, id: string): RoverEntryRecord | null {
  const stmt = db.prepare('SELECT * FROM rover_entry WHERE id = ?');
  const row = stmt.get(id) as RawEntryRow | undefined;
  return row ? parseEntryRow(row) : null;
}

export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  beforeSeq?: number;
  afterSeq?: number;
  turnId?: string;
  type?: 'message' | 'compaction';
  order?: 'asc' | 'desc';
}

export function listEntries(
  db: Database.Database,
  options: ListEntriesOptions = {}
): RoverEntryRecord[] {
  const { limit = 50, offset = 0, beforeSeq, afterSeq, turnId, type, order = 'asc' } = options;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (beforeSeq !== undefined) {
    conditions.push('seq < ?');
    params.push(beforeSeq);
  }
  if (afterSeq !== undefined) {
    conditions.push('seq > ?');
    params.push(afterSeq);
  }
  if (turnId !== undefined) {
    conditions.push('turn_id = ?');
    params.push(turnId);
  }
  if (type !== undefined) {
    conditions.push('type = ?');
    params.push(type);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderDirection = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  const sql = `
    SELECT * FROM rover_entry
    ${whereClause}
    ORDER BY seq ${orderDirection}
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as RawEntryRow[];
  return rows.map((r) => parseEntryRow(r));
}

export interface HistoryStats {
  totalEntries: number;
  totalMessages: number;
  totalCompactions: number;
  totalTurns: number;
  latestSeq: number;
}

export function getHistoryStats(db: Database.Database): HistoryStats {
  const entryStatsStmt = db.prepare(`
    SELECT
      COUNT(*) as total_entries,
      SUM(CASE WHEN type = 'message' THEN 1 ELSE 0 END) as total_messages,
      SUM(CASE WHEN type = 'compaction' THEN 1 ELSE 0 END) as total_compactions,
      MAX(seq) as latest_seq
    FROM rover_entry
  `);
  const entryStats = entryStatsStmt.get() as {
    total_entries: number;
    total_messages: number;
    total_compactions: number;
    latest_seq: number | null;
  };

  const turnStatsStmt = db.prepare('SELECT COUNT(*) as total_turns FROM rover_turn');
  const turnStats = turnStatsStmt.get() as { total_turns: number };

  return {
    totalEntries: entryStats.total_entries || 0,
    totalMessages: entryStats.total_messages || 0,
    totalCompactions: entryStats.total_compactions || 0,
    totalTurns: turnStats.total_turns || 0,
    latestSeq: entryStats.latest_seq || 0,
  };
}

export interface ListRoverTurnsOptions {
  limit?: number;
  offset?: number;
}

export function listRoverTurns(
  db: Database.Database,
  options: ListRoverTurnsOptions = {}
): RoverTurnRecord[] {
  const { limit = 30, offset = 0 } = options;
  const stmt = db.prepare(`
    SELECT * FROM rover_turn
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  const rows = stmt.all(limit, offset) as RawTurnRow[];
  return rows.map((r) => parseTurnRow(r));
}
