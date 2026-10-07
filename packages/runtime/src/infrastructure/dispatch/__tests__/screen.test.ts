import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  getScreenSessionInfo,
  getSessionName,
  killScreenSession,
  listRoverScreenSessions,
  parseScreenListOutput,
  startScreenSession,
  validateAttemptId,
  wipeDeadScreenSessions,
} from '../screen.js';

describe('screen module unit tests', () => {
  it('validates attemptId safety', () => {
    expect(() => validateAttemptId('valid-id_123')).not.toThrow();
    expect(() => validateAttemptId('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();

    expect(() => validateAttemptId('')).toThrow(/Invalid attempt ID/);
    expect(() => validateAttemptId('id with spaces')).toThrow(/Invalid attempt ID/);
    expect(() => validateAttemptId('id;rm -rf /')).toThrow(/Invalid attempt ID/);
    expect(() => validateAttemptId('id$TEST')).toThrow(/Invalid attempt ID/);
    expect(() => validateAttemptId('id`whoami`')).toThrow(/Invalid attempt ID/);
  });

  it('constructs canonical session names', () => {
    expect(getSessionName('attempt-1')).toBe('rover_attempt-1');
  });

  it('parses typical macOS screen -ls output', () => {
    const sampleOutput = `
There are screens on:
\t32067.rover_att-1\t(Detached)
\t32068.other_session\t(Detached)
\t32069.rover_att-2\t(Attached)
\t32070.rover_att-3\t(Dead ???)
3 Sockets in /var/folders/...
`;
    const parsed = parseScreenListOutput(sampleOutput);
    expect(parsed).toHaveLength(3);

    expect(parsed[0]).toEqual({
      attemptId: 'att-1',
      sessionName: 'rover_att-1',
      pid: 32067,
      status: 'detached',
    });

    expect(parsed[1]).toEqual({
      attemptId: 'att-2',
      sessionName: 'rover_att-2',
      pid: 32069,
      status: 'attached',
    });

    expect(parsed[2]).toEqual({
      attemptId: 'att-3',
      sessionName: 'rover_att-3',
      pid: 32070,
      status: 'dead',
    });
  });

  it('handles empty or no sockets output cleanly', () => {
    const emptyOutput = 'No Sockets found in /var/folders/...\n';
    expect(parseScreenListOutput(emptyOutput)).toEqual([]);
    expect(parseScreenListOutput('')).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('screen module live integration on macOS', () => {
  const activeAttemptIds: string[] = [];

  afterEach(async () => {
    for (const id of activeAttemptIds) {
      await killScreenSession(id);
    }
    activeAttemptIds.length = 0;
    await wipeDeadScreenSessions();
  });

  it('spawns a detached screen session, inspects status, and terminates cleanly', async () => {
    const attemptId = `test_live_${Date.now()}`;
    activeAttemptIds.push(attemptId);

    const session = await startScreenSession({
      attemptId,
      command: 'sleep',
      args: ['30'],
    });

    expect(session.attemptId).toBe(attemptId);
    expect(session.sessionName).toBe(`rover_${attemptId}`);
    expect(session.status).toBe('detached');
    expect(session.pid).toBeTypeOf('number');

    // Query session info individually
    const queried = await getScreenSessionInfo(attemptId);
    expect(queried).not.toBeNull();
    expect(queried?.attemptId).toBe(attemptId);
    expect(queried?.status).toBe('detached');

    // Query all rover sessions
    const all = await listRoverScreenSessions();
    expect(all.some((s) => s.attemptId === attemptId)).toBe(true);

    // Prevent duplicate start
    await expect(
      startScreenSession({
        attemptId,
        command: 'sleep',
        args: ['30'],
      })
    ).rejects.toThrow(/already active/);

    // Terminate session
    const killed = await killScreenSession(attemptId);
    expect(killed).toBe(true);

    // Should no longer be running
    const afterKill = await getScreenSessionInfo(attemptId);
    expect(afterKill).toBeNull();
  });

  it('preserves argument literal values and injects required environment variables without shell evaluation', async () => {
    const attemptId = `test_env_${Date.now()}`;
    activeAttemptIds.push(attemptId);
    const dumpFile = join(tmpdir(), `rover_test_probe_${attemptId}.json`);

    try {
      const complexArgWithSpaces = 'arg with multiple spaces';
      const dangerousInjectionArg = '; rm -rf / ; echo $TEST_VAL';
      const literalQuotesArg = 'nested "double" and \'single\' quotes';
      const reportToken = 'test-secret-report-token-12345';

      // Use node to inspect process.argv and process.env exactly as received
      const nodeScript = `
        const fs = require('node:fs');
        const dump = {
          argv: process.argv.slice(1),
          attemptId: process.env.ROVER_DISPATCH_ATTEMPT_ID,
          token: process.env.ROVER_REPORT_TOKEN,
          custom: process.env.CUSTOM_TEST_VAR,
        };
        fs.writeFileSync(process.argv[1], JSON.stringify(dump));
        // Keep process running briefly so screen does not immediately exit before verification
        setTimeout(() => {}, 20000);
      `;

      await startScreenSession({
        attemptId,
        command: process.execPath,
        args: [
          '-e',
          nodeScript,
          dumpFile,
          complexArgWithSpaces,
          dangerousInjectionArg,
          literalQuotesArg,
        ],
        env: {
          CUSTOM_TEST_VAR: 'custom_value_42',
        },
        reportToken,
      });

      // Poll briefly for file write
      let content = '';
      for (let i = 0; i < 20; i++) {
        if (existsSync(dumpFile)) {
          content = readFileSync(dumpFile, 'utf8');
          if (content.length > 0) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(content).not.toBe('');
      const dump = JSON.parse(content);

      // Verify exact arguments received (zero shell interpolation or mangling)
      expect(dump.argv[0]).toBe(dumpFile);
      expect(dump.argv[1]).toBe(complexArgWithSpaces);
      expect(dump.argv[2]).toBe(dangerousInjectionArg);
      expect(dump.argv[3]).toBe(literalQuotesArg);

      // Verify environment variables
      expect(dump.attemptId).toBe(attemptId);
      expect(dump.token).toBe(reportToken);
      expect(dump.custom).toBe('custom_value_42');
    } finally {
      if (existsSync(dumpFile)) {
        rmSync(dumpFile, { force: true });
      }
    }
  });

  it('rejects commands that immediately exit or fail to launch', async () => {
    const attemptId = `test_fail_${Date.now()}`;
    activeAttemptIds.push(attemptId);

    // true exits immediately (code 0)
    await expect(
      startScreenSession({
        attemptId,
        command: '/usr/bin/true',
      })
    ).rejects.toThrow(/failed to start or terminated immediately/);
  });
});
