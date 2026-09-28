import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDispatchAttempt, startScreenSession } from '../../src/index.js';
import { createAgentFixture } from './harness/agent-fixture.js';
import { writeArtifact } from './harness/artifacts.js';
import { inspectM1E2EEnvironment } from './harness/prerequisites.js';
import { createM1E2ERun, removeM1E2ERun } from './harness/run-context.js';
import {
  cleanupScreenSession,
  sendScreenInput,
  waitForScreenStatus,
} from './harness/screen-driver.js';
import { readSpoolEnvelopes, waitForHookMarker } from './harness/spool-probe.js';
import { readPidFile, terminateExactProcess } from './harness/terminal-driver.js';
import type { RealAgentType } from './harness/types.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const AGENTS: Array<{ agentType: RealAgentType }> = [
  { agentType: 'claude' },
  { agentType: 'codex' },
];

describe.each(AGENTS)('M1 $agentType Hook isolation', ({ agentType }) => {
  const isolationTest =
    agentType === 'codex' && process.env.ROVER_E2E_RUN_MODEL_TURN !== '1' ? it.skip : it;

  isolationTest(
    'does not persist Hook events for a real CLI session without a Rover attempt identity',
    async () => {
      await inspectM1E2EEnvironment();
      const run = createM1E2ERun(agentType);
      const attempt = createDispatchAttempt({ agentType, cwd: run.workspaceDir });
      const markerPath = path.join(run.rootDir, 'hook-invocations.log');
      const markerHelperPath = path.join(run.rootDir, 'hook-marker.sh');
      fs.writeFileSync(
        markerHelperPath,
        [
          '#!/bin/sh',
          `event="$1"`,
          `${shellQuote(run.helperPath)} "$@"`,
          'status="$?"',
          `printf '%s\\n' "$event" >> ${shellQuote(markerPath)}`,
          'exit "$status"',
          '',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o700 }
      );

      let fixture: Awaited<ReturnType<typeof createAgentFixture>> | undefined;
      try {
        fixture = await createAgentFixture(run, attempt, false, markerHelperPath);
        const manualAttemptId = `manual_${run.runId}`;
        const args = agentType === 'codex' ? ['-C', run.workspaceDir] : [];

        await startScreenSession({
          attemptId: manualAttemptId,
          command: fixture.wrapperPath,
          args,
          cwd: run.workspaceDir,
        });
        await waitForScreenStatus(manualAttemptId, 'detached');

        // Codex defers its SessionStart execution until a user turn begins. Keep its
        // identity-isolation probe opt-in because it submits one billable model turn.
        if (agentType === 'codex') {
          await sendScreenInput(
            manualAttemptId,
            `M1 E2E isolation probe ${run.runId}. Reply with OK. Do not use tools or modify files.\r`
          );
        }

        const invokedHooks = await waitForHookMarker(
          markerPath,
          agentType === 'codex' ? 'Stop' : 'SessionStart',
          agentType === 'codex' ? 120_000 : 15_000
        );
        if (agentType === 'codex') expect(invokedHooks).toContain('UserPromptSubmit');
        const events = readSpoolEnvelopes(run.spoolDir);
        writeArtifact(run.artifactsDir, 'hook-isolation.json', {
          runId: run.runId,
          agentType,
          invokedHooks,
          persistedEvents: events,
        });
        expect(events).toEqual([]);

        await cleanupScreenSession(manualAttemptId);
      } finally {
        const launchPid = fixture ? readPidFile(fixture.launchPidPath) : undefined;
        if (launchPid) terminateExactProcess(launchPid);
        await cleanupScreenSession(`manual_${run.runId}`);
        if (fs.existsSync(run.rootDir) && process.env.ROVER_E2E_KEEP_TEMP !== '1') {
          removeM1E2ERun(run);
        }
      }
    }
  );
});
