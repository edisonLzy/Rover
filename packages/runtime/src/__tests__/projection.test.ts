import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase } from '../storage/db.js';
import { runMigrations } from '../storage/migrator.js';
import {
  commitTaskWithSession,
  getTask,
  getSessionRef,
  listTaskEvents,
  insertDispatchAttempt,
} from '../storage/repositories/tasks.js';
import {
  TaskEventConsumer,
  TaskStateProjector,
  type SessionCarrier,
  type DispatchAttempt,
} from '../index.js';

describe('Ticket 007: Task Event Projection and Status Lifecycle', () => {
  let tempSpoolDir: string;
  let mockCarrier: SessionCarrier;

  beforeEach(() => {
    tempSpoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-projection-test-'));
    mockCarrier = {
      carrierType: 'screen',
      startSession: vi.fn(),
      getSessionInfo: vi.fn().mockResolvedValue(null),
      getSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([]),
      killSession: vi.fn().mockResolvedValue(true),
      stopSession: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(tempSpoolDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('1. accurately deduplicates spool events with duplicate event IDs in task_event table', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    const mockWsManager = { broadcast: vi.fn() };

    // Set up initial task and session
    insertDispatchAttempt(db.raw, {
      id: 'att_dedup_1',
      candidateTaskId: 'task_dedup_1',
      sourceKind: 'turn',
      sourceId: 'turn_1',
      agent: 'claude',
      cwd: '/workspace',
      reportToken: 'tok_1',
      status: 'starting',
    });

    commitTaskWithSession(db.raw, {
      attemptId: 'att_dedup_1',
      taskId: 'task_dedup_1',
      goal: 'Test deduplication',
      agent: 'claude',
      nativeSessionId: 'sess_native_1',
      configDir: '/workspace',
      carrierName: 'screen_att_dedup_1',
      wsManager: mockWsManager as any,
    });

    const consumer = new TaskEventConsumer({
      db: db.raw,
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
      wsManager: mockWsManager as any,
    });

    // Write duplicate spool envelopes with the exact same eventId
    const eventA = {
      attemptId: 'att_dedup_1',
      eventId: 'evt_dup_999',
      event: 'PreToolUse',
      timestamp: 1000,
      payload: { tool_name: 'bash', command: 'ls -la' },
    };

    const eventB = {
      attemptId: 'att_dedup_1',
      eventId: 'evt_dup_999', // Duplicate eventId!
      event: 'PreToolUse',
      timestamp: 1001,
      payload: { tool_name: 'bash', command: 'ls -la' },
    };

    fs.writeFileSync(path.join(tempSpoolDir, '1000_file_a.json'), JSON.stringify(eventA));
    fs.writeFileSync(path.join(tempSpoolDir, '1001_file_b.json'), JSON.stringify(eventB));

    // Drain spool files
    const consumed = await consumer.drain();
    expect(consumed).toHaveLength(2);

    // Verify task_event table only recorded the event once (plus initial 'dispatched' event = 2 total)
    const events = listTaskEvents(db.raw, 'task_dedup_1');
    const toolUseEvents = events.filter((e) => e.sourceEventId === 'evt_dup_999');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0].kind).toBe('PreToolUse');
  });

  it('2. transitions to needs_intervention on PermissionRequest and restores running on user action', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    const mockWsManager = { broadcast: vi.fn() };

    insertDispatchAttempt(db.raw, {
      id: 'att_perm_1',
      candidateTaskId: 'task_perm_1',
      sourceKind: 'turn',
      sourceId: 'turn_perm',
      agent: 'claude',
      cwd: '/workspace',
      reportToken: 'tok_perm',
      status: 'starting',
    });

    commitTaskWithSession(db.raw, {
      attemptId: 'att_perm_1',
      taskId: 'task_perm_1',
      goal: 'Execute dangerous migration',
      agent: 'claude',
      nativeSessionId: 'sess_perm_1',
      configDir: '/workspace',
      carrierName: 'screen_att_perm_1',
      wsManager: mockWsManager as any,
    });

    const consumer = new TaskEventConsumer({
      db: db.raw,
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
      wsManager: mockWsManager as any,
    });

    // 1. Spool event: PermissionRequest arrives
    const permEvent = {
      attemptId: 'att_perm_1',
      eventId: 'evt_perm_req_1',
      event: 'PermissionRequest',
      timestamp: 2000,
      summary: 'Approval required to run rm -rf /tmp/data',
      payload: { tool: 'bash', command: 'rm -rf /tmp/data' },
    };

    fs.writeFileSync(path.join(tempSpoolDir, '2000_perm.json'), JSON.stringify(permEvent));
    await consumer.drain();

    // Verify task status is now 'needs_intervention'
    const taskAfterPerm = getTask(db.raw, 'task_perm_1');
    expect(taskAfterPerm?.status).toBe('needs_intervention');
    expect(taskAfterPerm?.progressText).toContain('Approval required');

    // Verify WebSocket broadcast
    expect(mockWsManager.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.changed',
        payload: expect.objectContaining({
          taskId: 'task_perm_1',
          status: 'needs_intervention',
        }),
      })
    );

    // 2. User approves in terminal: PreToolUse or UserPromptSubmit arrives
    mockWsManager.broadcast.mockClear();
    const resumeEvent = {
      attemptId: 'att_perm_1',
      eventId: 'evt_tool_resume_1',
      event: 'PreToolUse',
      timestamp: 2500,
      summary: 'Running rm -rf /tmp/data after approval',
      payload: { tool: 'bash' },
    };

    fs.writeFileSync(path.join(tempSpoolDir, '2500_resume.json'), JSON.stringify(resumeEvent));
    await consumer.drain();

    // Verify status transitioned back to 'running'
    const taskAfterResume = getTask(db.raw, 'task_perm_1');
    expect(taskAfterResume?.status).toBe('running');
    expect(mockWsManager.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.changed',
        payload: expect.objectContaining({
          taskId: 'task_perm_1',
          status: 'running',
        }),
      })
    );
  });

  it('3. Stop event only pauses turn and NEVER marks task as completed', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    insertDispatchAttempt(db.raw, {
      id: 'att_stop_1',
      candidateTaskId: 'task_stop_1',
      sourceKind: 'turn',
      sourceId: 'turn_stop',
      agent: 'claude',
      cwd: '/workspace',
      reportToken: 'tok_stop',
      status: 'starting',
    });

    commitTaskWithSession(db.raw, {
      attemptId: 'att_stop_1',
      taskId: 'task_stop_1',
      goal: 'Multi-turn refactoring',
      agent: 'claude',
      nativeSessionId: 'sess_stop_1',
      configDir: '/workspace',
      carrierName: 'screen_att_stop_1',
    });

    const consumer = new TaskEventConsumer({
      db: db.raw,
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
    });

    const stopEvent = {
      attemptId: 'att_stop_1',
      eventId: 'evt_stop_1',
      event: 'Stop',
      timestamp: 3000,
      summary: 'Turn paused waiting for user next prompt',
    };

    fs.writeFileSync(path.join(tempSpoolDir, '3000_stop.json'), JSON.stringify(stopEvent));
    await consumer.drain();

    const task = getTask(db.raw, 'task_stop_1');
    expect(task?.status).toBe('running'); // MUST NOT be 'completed'!
  });

  it('4. marks unverified when carrier session exits without explicit completion report', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    const mockWsManager = { broadcast: vi.fn() };

    insertDispatchAttempt(db.raw, {
      id: 'att_crash_1',
      candidateTaskId: 'task_crash_1',
      sourceKind: 'turn',
      sourceId: 'turn_crash',
      agent: 'claude',
      cwd: '/workspace',
      reportToken: 'tok_crash',
      status: 'starting',
    });

    commitTaskWithSession(db.raw, {
      attemptId: 'att_crash_1',
      taskId: 'task_crash_1',
      goal: 'Build microservice',
      agent: 'claude',
      nativeSessionId: 'sess_crash_1',
      configDir: '/workspace',
      carrierName: 'screen_att_crash_1',
      wsManager: mockWsManager as any,
    });

    const consumer = new TaskEventConsumer({
      db: db.raw,
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
      wsManager: mockWsManager as any,
    });

    // 1. Process exits unexpectedly (e.g. SessionEnd event arrives without DoD report)
    const endEvent = {
      attemptId: 'att_crash_1',
      eventId: 'evt_end_unexpected',
      event: 'SessionEnd',
      timestamp: 4000,
    };

    fs.writeFileSync(path.join(tempSpoolDir, '4000_end.json'), JSON.stringify(endEvent));
    await consumer.drain();

    // Verify task is marked 'unverified', NOT 'completed'
    const task = getTask(db.raw, 'task_crash_1');
    expect(task?.status).toBe('unverified');

    // Verify session_ref availability is unavailable
    const sessionRef = getSessionRef(db.raw, 'task_crash_1');
    expect(sessionRef?.availability).toBe('unavailable');

    // Also test carrier exit handler directly
    const updated = consumer.handleCarrierExit('att_crash_1');
    expect(updated?.status).toBe('unverified');
  });

  it('5. marks completed only when explicit report(status: "completed") is issued and preserves completed state upon carrier exit', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    const mockWsManager = { broadcast: vi.fn() };

    insertDispatchAttempt(db.raw, {
      id: 'att_success_1',
      candidateTaskId: 'task_success_1',
      sourceKind: 'turn',
      sourceId: 'turn_success',
      agent: 'claude',
      cwd: '/workspace',
      reportToken: 'tok_success',
      status: 'starting',
    });

    commitTaskWithSession(db.raw, {
      attemptId: 'att_success_1',
      taskId: 'task_success_1',
      goal: 'Build authentication module',
      agent: 'claude',
      nativeSessionId: 'sess_success_1',
      configDir: '/workspace',
      carrierName: 'screen_att_success_1',
      wsManager: mockWsManager as any,
    });

    const consumer = new TaskEventConsumer({
      db: db.raw,
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
      wsManager: mockWsManager as any,
    });

    // DoD report arrives with status: 'completed'
    const reportEvent = {
      attemptId: 'att_success_1',
      token: 'tok_success',
      event: 'Report',
      status: 'completed',
      result: 'Auth module successfully implemented with 100% test coverage',
      summary: 'Finished all acceptance criteria',
      timestamp: 5000,
    };

    fs.writeFileSync(path.join(tempSpoolDir, '5000_report.json'), JSON.stringify(reportEvent));
    await consumer.drain();

    // Verify task is marked completed with result_text
    const task = getTask(db.raw, 'task_success_1');
    expect(task?.status).toBe('completed');
    expect(task?.resultText).toBe(
      'Auth module successfully implemented with 100% test coverage'
    );

    // Verify WebSocket broadcast
    expect(mockWsManager.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.changed',
        payload: expect.objectContaining({
          taskId: 'task_success_1',
          status: 'completed',
          resultText: 'Auth module successfully implemented with 100% test coverage',
        }),
      })
    );

    // Invariant: Once completed, subsequent carrier session exit DOES NOT degrade status to unverified
    consumer.handleCarrierExit('att_success_1');
    const taskAfterExit = getTask(db.raw, 'task_success_1');
    expect(taskAfterExit?.status).toBe('completed'); // Remains completed!

    const sessionRef = getSessionRef(db.raw, 'task_success_1');
    expect(sessionRef?.availability).toBe('unavailable');
  });

  it('6. marks failed when explicit report(status: "failed") is issued', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    insertDispatchAttempt(db.raw, {
      id: 'att_fail_1',
      candidateTaskId: 'task_fail_1',
      sourceKind: 'turn',
      sourceId: 'turn_fail',
      agent: 'codex',
      cwd: '/workspace',
      reportToken: 'tok_fail',
      status: 'starting',
    });

    commitTaskWithSession(db.raw, {
      attemptId: 'att_fail_1',
      taskId: 'task_fail_1',
      goal: 'Complex compilation',
      agent: 'codex',
      nativeSessionId: 'sess_fail_1',
      configDir: '/workspace',
      carrierName: 'screen_att_fail_1',
    });

    const consumer = new TaskEventConsumer({
      db: db.raw,
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
    });

    const failReport = {
      attemptId: 'att_fail_1',
      event: 'Report',
      status: 'failed',
      result: 'Compilation error: unresolved dependencies',
      summary: 'Build failed after 3 retries',
      timestamp: 6000,
    };

    fs.writeFileSync(path.join(tempSpoolDir, '6000_fail.json'), JSON.stringify(failReport));
    await consumer.drain();

    const task = getTask(db.raw, 'task_fail_1');
    expect(task?.status).toBe('failed');
    expect(task?.resultText).toBe('Compilation error: unresolved dependencies');
  });
});
