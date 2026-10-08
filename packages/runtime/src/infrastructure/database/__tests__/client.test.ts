import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  runMigrations,
  getAppliedMigrationVersions,
  type RoverDatabase,
} from '../index.js';
import { appendRuntimeEvent, getRuntimeEvents, getLatestEventSeq } from '../events.js';

describe('Storage Layer & Migrations (Ticket 001)', () => {
  let db: RoverDatabase;
  let tempDir: string | undefined;

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe('Database Connection & PRAGMA Settings', () => {
    it('initializes in-memory database with foreign keys and busy timeout', () => {
      db = openDatabase({ path: ':memory:' });
      expect(db.isMemory).toBe(true);

      const foreignKeys = db.raw.pragma('foreign_keys', { simple: true });
      expect(foreignKeys).toBe(1);

      const busyTimeout = db.raw.pragma('busy_timeout', { simple: true });
      expect(busyTimeout).toBe(5000);
    });

    it('initializes disk-based database in temp directory and enables WAL mode', () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-storage-test-'));
      const dbPath = path.join(tempDir, 'rover.db');

      db = openDatabase({ path: dbPath });
      expect(db.isMemory).toBe(false);
      expect(fs.existsSync(dbPath)).toBe(true);

      const journalMode = db.raw.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');

      const foreignKeys = db.raw.pragma('foreign_keys', { simple: true });
      expect(foreignKeys).toBe(1);
    });
  });

  describe('Migrations Execution & Idempotency', () => {
    it('applies initial migration v1 successfully and records in schema_migrations', () => {
      db = openDatabase({ path: ':memory:' });

      const result = runMigrations(db.raw);
      expect(result.appliedCount).toBe(1);
      expect(result.appliedVersions).toEqual([1]);
      expect(result.latestVersion).toBe(1);

      const appliedVersions = getAppliedMigrationVersions(db.raw);
      expect(appliedVersions).toEqual([1]);

      // Verify that core tables exist
      const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('rover_turn');
      expect(tableNames).toContain('rover_entry');
      expect(tableNames).toContain('runtime_event');
      expect(tableNames).toContain('dispatch_attempt');
      expect(tableNames).toContain('task');
      expect(tableNames).toContain('session_ref');
      expect(tableNames).toContain('task_event');
      expect(tableNames).toContain('task_summary');
      expect(tableNames).toContain('activity');
    });

    it('is strictly idempotent when running migrations repeatedly', () => {
      db = openDatabase({ path: ':memory:' });

      const firstRun = runMigrations(db.raw);
      expect(firstRun.appliedCount).toBe(1);

      const secondRun = runMigrations(db.raw);
      expect(secondRun.appliedCount).toBe(0);
      expect(secondRun.latestVersion).toBe(1);
    });
  });

  describe('Runtime Event Ledger & Transactions', () => {
    beforeEach(() => {
      db = openDatabase({ path: ':memory:' });
      runMigrations(db.raw);
    });

    it('records runtime events with monotonically increasing sequence numbers', () => {
      const e1 = appendRuntimeEvent(db.raw, {
        eventType: 'turn.delta',
        payload: { delta: 'hello' },
      });
      const e2 = appendRuntimeEvent(db.raw, {
        eventType: 'turn.delta',
        payload: { delta: ' world' },
      });
      const e3 = appendRuntimeEvent(db.raw, {
        eventType: 'turn.end',
        payload: { status: 'completed' },
      });

      expect(e1.eventSeq).toBe(1);
      expect(e2.eventSeq).toBe(2);
      expect(e3.eventSeq).toBe(3);

      expect(getLatestEventSeq(db.raw)).toBe(3);

      const allEvents = getRuntimeEvents(db.raw);
      expect(allEvents).toHaveLength(3);
      expect(allEvents[0].payload).toEqual({ delta: 'hello' });
      expect(allEvents[1].payload).toEqual({ delta: ' world' });
      expect(allEvents[2].payload).toEqual({ status: 'completed' });
    });

    it('supports afterSeq pagination for replay', () => {
      for (let i = 1; i <= 5; i++) {
        appendRuntimeEvent(db.raw, {
          eventType: 'test',
          payload: { index: i },
        });
      }

      const replayed = getRuntimeEvents(db.raw, { afterSeq: 2, limit: 2 });
      expect(replayed).toHaveLength(2);
      expect(replayed[0].eventSeq).toBe(3);
      expect(replayed[1].eventSeq).toBe(4);
    });

    it('atomically commits domain mutation and runtime event in a single transaction', () => {
      db.transaction(() => {
        db.raw
          .prepare(
            'INSERT INTO rover_turn (id, status, prompt_doc, created_at) VALUES (?, ?, ?, ?)'
          )
          .run('turn_1', 'running', JSON.stringify({ type: 'doc' }), Date.now());

        appendRuntimeEvent(db.raw, {
          eventType: 'turn.start',
          payload: { turnId: 'turn_1' },
        });
      });

      const turn = db.raw.prepare('SELECT * FROM rover_turn WHERE id = ?').get('turn_1');
      expect(turn).toBeDefined();

      const events = getRuntimeEvents(db.raw);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('turn.start');
    });

    it('rolls back both domain record and runtime event if transaction throws', () => {
      expect(() => {
        db.transaction(() => {
          db.raw
            .prepare(
              'INSERT INTO rover_turn (id, status, prompt_doc, created_at) VALUES (?, ?, ?, ?)'
            )
            .run('turn_rollback', 'running', JSON.stringify({ type: 'doc' }), Date.now());

          appendRuntimeEvent(db.raw, {
            eventType: 'turn.start',
            payload: { turnId: 'turn_rollback' },
          });

          throw new Error('Simulated failure during execution');
        });
      }).toThrow('Simulated failure during execution');

      const turn = db.raw.prepare('SELECT * FROM rover_turn WHERE id = ?').get('turn_rollback');
      expect(turn).toBeUndefined();

      const events = getRuntimeEvents(db.raw);
      expect(events).toHaveLength(0);
    });
  });

  describe('Schema Constraints & Invariants Verification', () => {
    beforeEach(() => {
      db = openDatabase({ path: ':memory:' });
      runMigrations(db.raw);
    });

    describe('rover_turn', () => {
      it('enforces status CHECK constraint', () => {
        expect(() => {
          db.raw
            .prepare(
              'INSERT INTO rover_turn (id, status, prompt_doc, created_at) VALUES (?, ?, ?, ?)'
            )
            .run('turn_invalid', 'unknown_status', JSON.stringify({}), Date.now());
        }).toThrow(/CHECK constraint failed/);
      });

      it('enforces json_valid constraint on prompt_doc', () => {
        expect(() => {
          db.raw
            .prepare(
              'INSERT INTO rover_turn (id, status, prompt_doc, created_at) VALUES (?, ?, ?, ?)'
            )
            .run('turn_invalid_json', 'running', 'not a json string', Date.now());
        }).toThrow(/CHECK constraint failed/);
      });
    });

    describe('rover_entry', () => {
      beforeEach(() => {
        db.raw
          .prepare(
            'INSERT INTO rover_turn (id, status, prompt_doc, created_at) VALUES (?, ?, ?, ?)'
          )
          .run('turn_valid', 'running', JSON.stringify({ text: 'hi' }), Date.now());
      });

      it('enforces foreign key to rover_turn for message entries', () => {
        expect(() => {
          db.raw
            .prepare(
              'INSERT INTO rover_entry (id, turn_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
            )
            .run('msg_orphan', 'non_existing_turn', 'message', JSON.stringify({}), Date.now());
        }).toThrow(/FOREIGN KEY constraint failed/);
      });

      it('enforces message type must have turn_id NOT NULL', () => {
        expect(() => {
          db.raw
            .prepare(
              'INSERT INTO rover_entry (id, turn_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
            )
            .run('msg_no_turn', null, 'message', JSON.stringify({}), Date.now());
        }).toThrow(/CHECK constraint failed/);
      });

      it('enforces compaction type must have turn_id NULL', () => {
        expect(() => {
          db.raw
            .prepare(
              'INSERT INTO rover_entry (id, turn_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
            )
            .run('comp_with_turn', 'turn_valid', 'compaction', JSON.stringify({}), Date.now());
        }).toThrow(/CHECK constraint failed/);
      });

      it('allows compaction type with turn_id NULL', () => {
        db.raw
          .prepare(
            'INSERT INTO rover_entry (id, turn_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(
            'comp_ok',
            null,
            'compaction',
            JSON.stringify({ summary: 'history summary' }),
            Date.now()
          );

        const comp = db.raw.prepare('SELECT * FROM rover_entry WHERE id = ?').get('comp_ok') as {
          type: string;
          turn_id: string | null;
        };
        expect(comp.type).toBe('compaction');
        expect(comp.turn_id).toBeNull();
      });

      it('cascades deletion from rover_turn to rover_entry', () => {
        db.raw
          .prepare(
            'INSERT INTO rover_entry (id, turn_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run('msg_cascade', 'turn_valid', 'message', JSON.stringify({ text: 'hi' }), Date.now());

        db.raw.prepare('DELETE FROM rover_turn WHERE id = ?').run('turn_valid');

        const entry = db.raw.prepare('SELECT * FROM rover_entry WHERE id = ?').get('msg_cascade');
        expect(entry).toBeUndefined();
      });
    });

    describe('task & session_ref', () => {
      it('enforces foreign key from session_ref to task', () => {
        expect(() => {
          db.raw
            .prepare(`
              INSERT INTO session_ref (
                task_id, agent, native_session_id, config_dir, carrier_kind, carrier_name, availability, last_seen
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              'non_existent_task',
              'claude',
              'session_123',
              '~/.claude',
              'screen',
              'rover_att_123',
              'available',
              Date.now()
            );
        }).toThrow(/FOREIGN KEY constraint failed/);
      });

      it('successfully links task and session_ref atomically', () => {
        const now = Date.now();
        db.transaction(() => {
          db.raw
            .prepare(`
              INSERT INTO task (id, goal, agent, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run('task_100', 'Fix bug in runtime', 'claude', 'running', now, now);

          db.raw
            .prepare(`
              INSERT INTO session_ref (
                task_id, agent, native_session_id, config_dir, carrier_kind, carrier_name, availability, last_seen
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              'task_100',
              'claude',
              'native_uuid_100',
              '~/.claude',
              'screen',
              'rover_att_100',
              'available',
              now
            );
        });

        const task = db.raw.prepare('SELECT * FROM task WHERE id = ?').get('task_100');
        const session = db.raw
          .prepare('SELECT * FROM session_ref WHERE task_id = ?')
          .get('task_100');

        expect(task).toBeDefined();
        expect(session).toBeDefined();
      });
    });
  });
});
