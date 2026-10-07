import { describe, it, expect, vi } from 'vitest';
import { openDatabase } from '../../database/client.js';
import { runMigrations } from '../../database/migrator.js';
import {
  insertDispatchAttempt,
  getDispatchAttempt,
  commitTaskWithSession,
  getTask,
  listTasks,
  getSessionRef,
  listTaskEvents,
} from '../../../modules/tasks/index.js';
import { createDispatchAgentTool } from '../../../modules/agent/index.js';
import type { SessionCarrier, StartCarrierSessionOptions, CarrierSessionInfo } from '../carrier.js';

class MockSessionCarrier implements SessionCarrier {
  readonly carrierType = 'screen' as const;
  public shouldFail = false;
  public startedSessions: StartCarrierSessionOptions[] = [];

  async startSession(options: StartCarrierSessionOptions): Promise<CarrierSessionInfo> {
    if (this.shouldFail) {
      throw new Error('Screen process terminated unexpectedly with code 1');
    }
    this.startedSessions.push(options);
    return {
      attemptId: options.attemptId,
      sessionName: `screen_mock_${options.attemptId}`,
      pid: 12345,
      status: 'detached',
      carrierType: 'screen',
    };
  }

  async getSessionInfo(_attemptId: string): Promise<CarrierSessionInfo | null> {
    return null;
  }

  async listSessions(): Promise<CarrierSessionInfo[]> {
    return [];
  }

  async killSession(_attemptId: string): Promise<boolean> {
    return true;
  }
}

describe('Ticket 006: Task Transaction Creation & Controlled Dispatch Flow', () => {
  it('strictly guarantees no empty Task is created before session confirmation', () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    // 1. Record starting dispatch attempt
    const attempt = insertDispatchAttempt(db.raw, {
      id: 'att_test_1',
      candidateTaskId: 'task_cand_1',
      sourceKind: 'turn',
      sourceId: 'turn_1',
      agent: 'claude',
      cwd: '/Users/evan/workspace',
      reportToken: 'test_token_123',
      status: 'starting',
    });

    expect(attempt.status).toBe('starting');
    expect(attempt.reportTokenHash).toBeDefined();

    // Invariant: task table must have 0 rows
    const tasks = listTasks(db.raw);
    expect(tasks).toHaveLength(0);
    expect(getTask(db.raw, 'task_cand_1')).toBeNull();
  });

  it('commitTaskWithSession executes atomic single transaction and broadcasts task.changed', () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    // Prepare starting attempt
    insertDispatchAttempt(db.raw, {
      id: 'att_test_2',
      candidateTaskId: 'task_uuid_2',
      sourceKind: 'turn',
      sourceId: 'turn_2',
      agent: 'claude',
      cwd: '/Users/evan/workspace',
      reportToken: 'test_token_456',
      status: 'starting',
    });

    const mockWsManager = {
      broadcast: vi.fn(),
    };

    // Execute atomic transaction
    const { task, sessionRef } = commitTaskWithSession(db.raw, {
      attemptId: 'att_test_2',
      taskId: 'task_uuid_2',
      goal: 'Implement login page',
      agent: 'claude',
      nativeSessionId: 'claude_session_abc',
      configDir: '/Users/evan/workspace',
      carrierName: 'screen_att_test_2',
      wsManager: mockWsManager as any,
    });

    // 1. Verify Task created
    expect(task.id).toBe('task_uuid_2');
    expect(task.status).toBe('running');
    expect(task.goal).toBe('Implement login page');

    // 2. Verify SessionRef created
    expect(sessionRef.taskId).toBe('task_uuid_2');
    expect(sessionRef.nativeSessionId).toBe('claude_session_abc');
    expect(sessionRef.availability).toBe('available');

    // 3. Verify dispatch_attempt advanced to 'registered'
    const updatedAttempt = getDispatchAttempt(db.raw, 'att_test_2');
    expect(updatedAttempt?.status).toBe('registered');
    expect(updatedAttempt?.nativeSessionId).toBe('claude_session_abc');

    // 4. Verify initial task_event recorded
    const events = listTaskEvents(db.raw, 'task_uuid_2');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('dispatched');
    expect(events[0].taskId).toBe('task_uuid_2');

    // 5. Verify WebSocket broadcast was invoked
    expect(mockWsManager.broadcast).toHaveBeenCalledWith({
      type: 'task.changed',
      payload: expect.objectContaining({
        taskId: 'task_uuid_2',
        status: 'running',
        agent: 'claude',
        nativeSessionId: 'claude_session_abc',
      }),
    });
  });

  it('dispatch_agent tool with Claude executes full dispatch and creates atomic task', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);
    const mockCarrier = new MockSessionCarrier();

    const tool = createDispatchAgentTool({
      db,
      carrier: mockCarrier,
      getCurrentTurnId: () => 'turn_current_test',
    });

    const result = await tool.execute('call_dispatch_1', {
      agent: 'claude',
      cwd: '/Users/evan/project',
      taskPrompt: 'Refactor auth controller',
    });

    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Task successfully dispatched to claude!');
    expect(result.details.status).toBe('running');
    expect(result.details.taskId).toBeDefined();

    // Verify task exists in SQLite
    const task = getTask(db.raw, result.details.taskId);
    expect(task).not.toBeNull();
    expect(task?.goal).toBe('Refactor auth controller');
    expect(task?.status).toBe('running');

    // Verify session_ref exists
    const sessionRef = getSessionRef(db.raw, result.details.taskId);
    expect(sessionRef).not.toBeNull();
    expect(sessionRef?.nativeSessionId).toBe(result.details.nativeSessionId);
  });

  it('dispatch_agent tool with Codex (deferred) launches carrier but defers task creation', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);
    const mockCarrier = new MockSessionCarrier();

    const tool = createDispatchAgentTool({
      db,
      carrier: mockCarrier,
      getCurrentTurnId: () => 'turn_codex_test',
    });

    const result = await tool.execute('call_dispatch_2', {
      agent: 'codex',
      cwd: '/Users/evan/codex_project',
      taskPrompt: 'Fix type error in index.ts',
    });

    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('deferred session confirmation');
    expect(result.details.status).toBe('starting');
    expect(result.details.candidateTaskId).toBeDefined();

    // Invariant: Since session is deferred and unconfirmed, Task table MUST be empty!
    const task = getTask(db.raw, result.details.candidateTaskId);
    expect(task).toBeNull();
    expect(listTasks(db.raw)).toHaveLength(0);

    // Verify dispatch_attempt exists in 'starting' status
    const attempt = getDispatchAttempt(db.raw, result.details.attemptId);
    expect(attempt).not.toBeNull();
    expect(attempt?.status).toBe('starting');
  });

  it('dispatch_agent tool aborts cleanly and leaves zero tasks when carrier launch fails', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);
    const failingCarrier = new MockSessionCarrier();
    failingCarrier.shouldFail = true;

    const tool = createDispatchAgentTool({
      db,
      carrier: failingCarrier,
    });

    const result = await tool.execute('call_dispatch_3', {
      agent: 'claude',
      cwd: '/Users/evan/fail_project',
      taskPrompt: 'Should fail gracefully',
    });

    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Failed to launch claude process');
    expect(text).toContain('No Task was created');
    expect(result.details.error).toBe('launch_failed');

    // Red line check: task table must have 0 rows
    expect(listTasks(db.raw)).toHaveLength(0);

    // Verify attempt recorded failure
    const attempt = getDispatchAttempt(db.raw, result.details.attemptId);
    expect(attempt?.status).toBe('failed');
    expect(attempt?.error).toContain('Screen process terminated unexpectedly');
  });

  it('dispatch_agent tool rejects non-absolute cwd without database write', async () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);
    const mockCarrier = new MockSessionCarrier();

    const tool = createDispatchAgentTool({
      db,
      carrier: mockCarrier,
    });

    const result = await tool.execute('call_dispatch_4', {
      agent: 'claude',
      cwd: 'relative/path',
      taskPrompt: 'Invalid path test',
    });

    expect(result.details.error).toBe('invalid_cwd');
    expect(listTasks(db.raw)).toHaveLength(0);
    expect(mockCarrier.startedSessions).toHaveLength(0);
  });
});
