import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SpoolConsumer } from '../index.js';
import type { DispatchAttempt, SessionCarrier } from '../../dispatch/index.js';

describe('Spool Consumer & Session State Ingestion (M1-3 / M1-4)', () => {
  let tempSpoolDir: string;
  let mockCarrier: SessionCarrier;

  beforeEach(() => {
    tempSpoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-spool-test-'));
    mockCarrier = {
      carrierType: 'screen',
      startSession: vi.fn(),
      getSessionInfo: vi.fn(),
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

  it('scans and consumes spool events chronologically while ignoring tmp files', async () => {
    const consumer = new SpoolConsumer({
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
    });

    // Write a temporary file (should be ignored)
    fs.writeFileSync(path.join(tempSpoolDir, 'tmp_123.tmp'), '{"incomplete":true}');

    // Write two ordered events
    const event1 = {
      attemptId: 'att_001',
      event: 'SessionStart',
      timestamp: 1000,
      payload: { session_id: 'sess_abc' },
    };
    const event2 = {
      attemptId: 'att_001',
      event: 'PreToolUse',
      timestamp: 2000,
      payload: { tool_name: 'bash' },
    };

    fs.writeFileSync(path.join(tempSpoolDir, '1000_uuid1.json'), JSON.stringify(event1));
    fs.writeFileSync(path.join(tempSpoolDir, '2000_uuid2.json'), JSON.stringify(event2));

    const consumed = await consumer.drain();
    expect(consumed).toHaveLength(2);
    expect(consumed[0].envelope.event).toBe('SessionStart');
    expect(consumed[1].envelope.event).toBe('PreToolUse');

    // Subsequent drain should not re-process the same files
    const secondDrain = await consumer.drain();
    expect(secondDrain).toHaveLength(0);
  });

  it('authoritatively confirms deferred session on SessionStart hook', async () => {
    const attempt: DispatchAttempt = {
      attemptId: 'att_codex_999',
      reservedTaskUuid: 'task_uuid_123',
      reportToken: 'token_123',
      agentType: 'codex',
      cwd: '/fake/path',
      sessionIdStrategy: 'deferred',
      status: 'launched',
      createdAt: Date.now(),
    };

    let confirmedCandidate: any = null;
    const consumer = new SpoolConsumer({
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
      onSessionConfirmed: (candidate) => {
        confirmedCandidate = candidate;
      },
    });

    consumer.registerAttempt(attempt);

    // Codex SessionStart event
    const codexStartEvent = {
      attemptId: 'att_codex_999',
      event: 'SessionStart',
      timestamp: 1500,
      payload: { session_id: 'codex_sess_native_xyz' },
      agentType: 'codex',
    };

    fs.writeFileSync(
      path.join(tempSpoolDir, '1500_codex_start.json'),
      JSON.stringify(codexStartEvent)
    );

    await consumer.drain();

    expect(attempt.status).toBe('confirmed');
    expect(attempt.nativeSessionId).toBe('codex_sess_native_xyz');
    expect(confirmedCandidate).toBeDefined();
    expect(confirmedCandidate.nativeSessionId).toBe('codex_sess_native_xyz');
  });

  it('triggers carrier session reclamation when terminal report arrives', async () => {
    let terminalReportReceived = false;

    const consumer = new SpoolConsumer({
      spoolDir: tempSpoolDir,
      carrier: mockCarrier,
      autoStopCarrierOnComplete: true,
      onTerminalReport: (envelope) => {
        terminalReportReceived = true;
        expect(envelope.status).toBe('completed');
      },
    });

    const reportEvent = {
      attemptId: 'att_task_finish',
      event: 'Report',
      status: 'completed',
      result: 'Task finished successfully',
      summary: 'All checks passed',
      timestamp: 3000,
    };

    fs.writeFileSync(
      path.join(tempSpoolDir, '3000_report_finish.json'),
      JSON.stringify(reportEvent)
    );

    await consumer.drain();

    expect(terminalReportReceived).toBe(true);
    // Verified carrier.stopSession was called to free Screen/TTY
    expect(mockCarrier.stopSession).toHaveBeenCalledWith('att_task_finish');
  });

  it('deletes consumed files when deleteConsumedFiles is enabled', async () => {
    const consumer = new SpoolConsumer({
      spoolDir: tempSpoolDir,
      deleteConsumedFiles: true,
    });

    const event = {
      attemptId: 'att_del',
      event: 'Ping',
      timestamp: 4000,
    };

    const targetPath = path.join(tempSpoolDir, '4000_del.json');
    fs.writeFileSync(targetPath, JSON.stringify(event));
    expect(fs.existsSync(targetPath)).toBe(true);

    await consumer.drain();
    expect(fs.existsSync(targetPath)).toBe(false);
  });
});
