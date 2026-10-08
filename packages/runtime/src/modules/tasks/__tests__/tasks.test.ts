import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../../infrastructure/database/client.js';
import { runMigrations } from '../../../infrastructure/database/migrator.js';
import { insertDispatchAttempt, commitTaskWithSession, updateTaskStatus } from '../repository.js';
import type { RoverDatabase } from '../../../infrastructure/database/types.js';
import { sessionCarrier, executeTerminalAction } from '../../../infrastructure/dispatch/index.js';
import { TaskService } from '../service.js';
import { tasksRouter } from '../router.js';
import { appRouter } from '../../../transport/router.js';
import type { Context } from '../../../transport/context.js';

vi.mock('../../../infrastructure/dispatch/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../infrastructure/dispatch/index.js')>();
  return {
    ...actual,
    executeTerminalAction: vi.fn(async (action) => ({
      success: true,
      action,
      script: 'mock terminal script',
    })),
  };
});

let database: RoverDatabase;
let service: TaskService;
let authenticated: Context;
const nativeSessionId = '990ee48b-3e2b-426b-bfdc-b620ee6d41dc';

beforeEach(() => {
  vi.clearAllMocks();
  database = openDatabase({ path: ':memory:' });
  runMigrations(database.raw);
  vi.spyOn(sessionCarrier, 'getSessionInfo').mockResolvedValue(null);
  vi.spyOn(sessionCarrier, 'getSession').mockResolvedValue(null);
  vi.mocked(executeTerminalAction).mockImplementation(async (action) => ({
    success: true,
    action,
    script: 'mock terminal script',
  }));
  service = new TaskService({
    db: database.raw,
  });
  authenticated = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    token: 'test-token',
    isAuthenticated: true,
    container: { taskService: service } as any,
  };
  registerTask('task-one', nativeSessionId);
  registerTask('task-two', '991ee48b-3e2b-426b-bfdc-b620ee6d41dc');
});

afterEach(() => {
  database.close();
});

describe('Task service and route contract', () => {
  it('lists session references and respects status filtering and limits', () => {
    updateTaskStatus(database.raw, { taskId: 'task-one', status: 'needs_intervention' });
    expect(service.list()).toHaveLength(2);
    expect(service.list({ status: 'needs_intervention', limit: 1 })).toEqual([
      expect.objectContaining({
        id: 'task-one',
        status: 'needs_intervention',
        sessionRef: expect.objectContaining({ nativeSessionId, availability: 'available' }),
      }),
    ]);
  });

  it('gets the task, original session and recorded events', () => {
    expect(service.get('task-one')).toMatchObject({
      task: { id: 'task-one' },
      sessionRef: { taskId: 'task-one', nativeSessionId },
      events: [expect.objectContaining({ kind: 'dispatched' })],
    });
  });

  it('attaches using the dispatch attempt ID rather than the task ID', async () => {
    vi.spyOn(sessionCarrier, 'getSession').mockResolvedValue({
      attemptId: 'task-one-attempt',
      sessionName: 'rover_task-one-attempt',
      status: 'detached',
      pid: 1234,
      carrierType: 'screen',
    });
    const result = await service.openTerminal('task-one');
    expect(sessionCarrier.getSession).toHaveBeenCalledWith('task-one-attempt');
    expect(executeTerminalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'attach',
        attemptId: 'task-one-attempt',
        args: ['-r', 'rover_task-one-attempt'],
        cwd: '/test/project',
      })
    );
    expect(result).toMatchObject({ success: true, actionType: 'attach' });
  });

  it('resumes the original native session when its carrier has exited', async () => {
    const result = await service.openTerminal('task-one');
    expect(executeTerminalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resume',
        nativeSessionId,
        args: ['--dangerously-skip-permissions', '--resume', nativeSessionId],
      })
    );
    expect(result).toMatchObject({ success: true, actionType: 'resume' });
    expect(result.shellCommand).toContain(nativeSessionId);
    expect(result.notice).toContain('Yes, I trust this folder');
  });

  it('preserves terminal permission errors in the public result', async () => {
    vi.mocked(executeTerminalAction).mockImplementationOnce(async (action) => ({
      success: false,
      action,
      script: 'mock terminal script',
      error: 'Automation denied',
      permissionDenied: true,
    }));
    expect(await service.openTerminal('task-one')).toMatchObject({
      success: false,
      error: 'Automation denied',
      permissionDenied: true,
    });
  });

  it('retains the nested appRouter tasks.list and tasks.get endpoints', async () => {
    const caller = appRouter.createCaller(authenticated);
    expect(await caller.tasks.list({ limit: 1 })).toHaveLength(1);
    expect(await caller.tasks.get({ taskId: 'task-one' })).toEqual(service.get('task-one'));
  });

  it('maps missing tasks to NOT_FOUND without executing terminal automation', async () => {
    const caller = tasksRouter.createCaller(authenticated);
    await expect(caller.get({ taskId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.openTerminal({ taskId: 'missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(executeTerminalAction).not.toHaveBeenCalled();
  });

  it('maps a missing session reference to PRECONDITION_FAILED', async () => {
    database.raw.prepare('DELETE FROM session_ref WHERE task_id = ?').run('task-one');
    const caller = tasksRouter.createCaller(authenticated);
    await expect(caller.openTerminal({ taskId: 'task-one' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(executeTerminalAction).not.toHaveBeenCalled();
  });

  it('rejects invalid parameters before invoking the service', async () => {
    const list = vi.spyOn(service, 'list');
    const get = vi.spyOn(service, 'get');
    const caller = tasksRouter.createCaller(authenticated);
    await expect(caller.list({ limit: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.get({ taskId: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('requires authentication for every task endpoint', async () => {
    const caller = tasksRouter.createCaller({
      ...authenticated,
      isAuthenticated: false,
    });
    await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.get({ taskId: 'task-one' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(caller.openTerminal({ taskId: 'task-one' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(executeTerminalAction).not.toHaveBeenCalled();
  });
});

function registerTask(taskId: string, nativeSessionId: string): void {
  const attemptId = `${taskId}-attempt`;
  insertDispatchAttempt(database.raw, {
    id: attemptId,
    candidateTaskId: taskId,
    sourceKind: 'turn',
    sourceId: 'test-turn',
    agent: 'claude',
    cwd: '/test/project',
    reportToken: `test-token-${taskId}`,
  });
  commitTaskWithSession(database.raw, {
    attemptId,
    taskId,
    goal: `Test ${taskId}`,
    agent: 'claude',
    nativeSessionId,
    configDir: '/test/project',
    carrierName: `rover_${attemptId}`,
  });
}
