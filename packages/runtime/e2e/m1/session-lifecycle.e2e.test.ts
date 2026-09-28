import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ScreenSessionCarrier,
  createDispatchAttempt,
  getScreenSessionInfo,
  resolveTerminalAction,
} from '../../src/index.js';
import { createAgentFixture } from './harness/agent-fixture.js';
import { writeArtifact } from './harness/artifacts.js';
import { launchDispatchInShortLivedProcess } from './harness/launch-in-child.js';
import { inspectM1E2EEnvironment } from './harness/prerequisites.js';
import { createM1E2ERun, removeM1E2ERun } from './harness/run-context.js';
import {
  cleanupScreenSession,
  detachScreenSession,
  sendScreenInput,
  waitForScreenExit,
  waitForScreenStatus,
} from './harness/screen-driver.js';
import {
  readSpoolEnvelopes,
  waitForNativeSession,
  waitForNewSessionStart,
  waitForSpoolEvent,
} from './harness/spool-probe.js';
import {
  closeCreatedTerminalTab,
  executeRealTerminalAction,
  readPidFile,
  terminateExactProcess,
  waitForPidFile,
} from './harness/terminal-driver.js';
import type { AgentFixture, RealAgentType } from './harness/types.js';

const AGENTS: Array<{ agentType: RealAgentType }> = [
  { agentType: 'claude' },
  { agentType: 'codex' },
];

function assertNativeSessionId(agentType: RealAgentType, sessionId: string, attemptId: string) {
  expect(sessionId).toBeTruthy();
  if (agentType === 'claude') {
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  }
  expect(attemptId).toMatch(/^att_[a-zA-Z0-9_-]+$/);
}

async function launchRealAgent(
  agentType: RealAgentType,
  runId: string,
  cwd: string,
  runRoot: string,
  spoolDir: string,
  helperPath: string,
  bindNativeSessionAtLaunch: boolean
) {
  const attempt = createDispatchAttempt({ agentType, cwd });
  const run = {
    runId,
    agentType,
    rootDir: runRoot,
    spoolDir,
    artifactsDir: '',
    helperPath,
    workspaceDir: cwd,
  };
  const fixture = await createAgentFixture(run, attempt);
  const previousPathOverride = process.env[fixture.environmentOverride];
  process.env[fixture.environmentOverride] = fixture.wrapperPath;

  try {
    const launchedAttempt = await launchDispatchInShortLivedProcess(run, {
      attempt,
      options: { agentType, cwd, cliPath: fixture.wrapperPath },
    });
    const screen = await waitForScreenStatus(attempt.attemptId, 'detached');
    const nativeSessionId = bindNativeSessionAtLaunch
      ? await waitForNativeSession(launchedAttempt, spoolDir)
      : undefined;
    if (nativeSessionId) assertNativeSessionId(agentType, nativeSessionId, attempt.attemptId);

    return { attempt, fixture, launchedAttempt, screen, nativeSessionId, previousPathOverride };
  } catch (error) {
    await cleanupScreenSession(attempt.attemptId).catch(() => undefined);
    const launchPid = readPidFile(fixture.launchPidPath);
    if (launchPid) terminateExactProcess(launchPid);
    if (previousPathOverride === undefined) {
      delete process.env[fixture.environmentOverride];
    } else {
      process.env[fixture.environmentOverride] = previousPathOverride;
    }
    throw error;
  }
}

async function restoreAgentPath(fixture: AgentFixture, previousPathOverride: string | undefined) {
  if (previousPathOverride === undefined) {
    delete process.env[fixture.environmentOverride];
  } else {
    process.env[fixture.environmentOverride] = previousPathOverride;
  }
}

describe.each(AGENTS)('M1 real $agentType session lifecycle', ({ agentType }) => {
  it('launches in Screen, survives the launcher, and attaches Terminal to the same session', async () => {
    const environment = await inspectM1E2EEnvironment();
    const run = createM1E2ERun(agentType);
    const terminalTabs: string[] = [];
    let session: Awaited<ReturnType<typeof launchRealAgent>> | undefined;

    try {
      session = await launchRealAgent(
        agentType,
        run.runId,
        run.workspaceDir,
        run.rootDir,
        run.spoolDir,
        run.helperPath,
        agentType === 'claude'
      );

      expect(session.launchedAttempt.status).toBe(
        agentType === 'claude' ? 'confirmed' : 'launched'
      );
      if (agentType === 'claude') expect(session.nativeSessionId).toBeTruthy();
      expect(session.launchedAttempt.carrierSessionName).toBe(session.screen.sessionName);
      expect(await getScreenSessionInfo(session.attempt.attemptId)).toMatchObject({
        sessionName: session.screen.sessionName,
        pid: session.screen.pid,
        status: 'detached',
      });

      const action = await resolveTerminalAction({
        attemptId: session.attempt.attemptId,
        agentType,
        nativeSessionId: session.nativeSessionId,
        cwd: run.workspaceDir,
        carrier: new ScreenSessionCarrier('/usr/bin/screen'),
      });
      expect(action.type).toBe('attach');
      expect(action.args).toEqual(['-r', session.screen.sessionName]);

      const result = await executeRealTerminalAction(action);
      if (result.output) terminalTabs.push(result.output);

      const attached = await waitForScreenStatus(session.attempt.attemptId, 'attached');
      expect(attached.sessionName).toBe(session.screen.sessionName);
      expect(attached.pid).toBe(session.screen.pid);

      await detachScreenSession(attached.sessionName);
      await waitForScreenStatus(session.attempt.attemptId, 'detached');

      writeArtifact(run.artifactsDir, 'summary.json', {
        runId: run.runId,
        agentType,
        environment,
        attempt: session.launchedAttempt,
        nativeSessionId: session.nativeSessionId,
        initialScreen: session.screen,
        attachedScreen: attached,
        attachAction: action,
      });
    } catch (error) {
      writeArtifact(run.artifactsDir, 'failure.json', {
        runId: run.runId,
        agentType,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        spoolEvents: readSpoolEnvelopes(run.spoolDir),
      });
      throw error;
    } finally {
      if (session) {
        await cleanupScreenSession(session.attempt.attemptId);
        await restoreAgentPath(session.fixture, session.previousPathOverride);
        const launchPid = readPidFile(session.fixture.launchPidPath);
        if (launchPid) terminateExactProcess(launchPid);
      }
      for (const tab of terminalTabs) await closeCreatedTerminalTab(tab);
      if (fs.existsSync(run.rootDir) && process.env.ROVER_E2E_KEEP_TEMP !== '1') {
        removeM1E2ERun(run);
      }
    }
  });

  const resumeTest = process.env.ROVER_E2E_RUN_MODEL_TURN === '1' ? it : it.skip;

  resumeTest('resumes a completed CLI conversation by its original native session ID', async () => {
    const environment = await inspectM1E2EEnvironment();
    const run = createM1E2ERun(agentType);
    let session: Awaited<ReturnType<typeof launchRealAgent>> | undefined;
    let resumePid: number | undefined;
    const terminalTabs: string[] = [];

    try {
      session = await launchRealAgent(
        agentType,
        run.runId,
        run.workspaceDir,
        run.rootDir,
        run.spoolDir,
        run.helperPath,
        agentType === 'claude'
      );

      const probePrompt = `M1 E2E probe ${run.runId}. Reply with exactly ROVER_E2E_READY. Do not use tools or modify files.`;
      await sendScreenInput(session.screen.sessionName, `${probePrompt}\r`);
      const nativeSessionId =
        session.nativeSessionId ??
        (await waitForNativeSession(session.launchedAttempt, run.spoolDir, 120_000));
      session.nativeSessionId = nativeSessionId;
      assertNativeSessionId(agentType, nativeSessionId, session.attempt.attemptId);
      const probeResult = await waitForSpoolEvent(
        run.spoolDir,
        ({ envelope }) =>
          envelope.attemptId === session!.attempt.attemptId &&
          (envelope.event === 'Stop' || envelope.event === 'StopFailure'),
        `${agentType} to finish its read-only probe turn`
      );
      expect(
        probeResult.envelope.event,
        `${agentType} probe did not complete successfully; check CLI billing and authentication.`
      ).toBe('Stop');

      await sendScreenInput(session.screen.sessionName, '/exit\r');
      await waitForScreenExit(session.attempt.attemptId, 45_000);

      const knownSpoolFiles = new Set(
        readSpoolEnvelopes(run.spoolDir).map(({ filename }) => filename)
      );
      const action = await resolveTerminalAction({
        attemptId: session.attempt.attemptId,
        agentType,
        nativeSessionId,
        cwd: run.workspaceDir,
        carrier: new ScreenSessionCarrier('/usr/bin/screen'),
      });
      expect(action.type).toBe('resume');
      expect(action.command).toBe(session.fixture.wrapperPath);
      expect(action.args).toEqual(
        agentType === 'claude' ? ['--resume', nativeSessionId] : ['resume', nativeSessionId]
      );

      // Codex runs SessionStart as part of the resumed turn. Its optional real-model
      // probe is passed after the native session ID so this remains one resume launch.
      const resumePrompt = `M1 E2E resume probe ${run.runId}. Reply OK. Do not use tools or modify files.`;
      const executionAction =
        agentType === 'codex' ? { ...action, args: [...action.args, resumePrompt] } : action;
      const result = await executeRealTerminalAction(executionAction);
      if (result.output) terminalTabs.push(result.output);
      resumePid = await waitForPidFile(session.fixture.resumePidPath);

      const resumed = await waitForNewSessionStart(
        run.spoolDir,
        knownSpoolFiles,
        session.nativeSessionId
      );
      expect(resumed.envelope.attemptId).toBe(session.attempt.attemptId);

      writeArtifact(run.artifactsDir, 'resume-summary.json', {
        runId: run.runId,
        agentType,
        environment,
        nativeSessionId,
        probeEvent: probeResult.envelope,
        resumeAction: action,
        codexResumeTurnSubmitted: agentType === 'codex',
        resumedEvent: resumed.envelope,
      });
    } catch (error) {
      writeArtifact(run.artifactsDir, 'resume-failure.json', {
        runId: run.runId,
        agentType,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        spoolEvents: readSpoolEnvelopes(run.spoolDir),
      });
      throw error;
    } finally {
      if (session) {
        await cleanupScreenSession(session.attempt.attemptId);
        await restoreAgentPath(session.fixture, session.previousPathOverride);
        const launchPid = readPidFile(session.fixture.launchPidPath);
        if (launchPid) terminateExactProcess(launchPid);
      }
      if (resumePid) terminateExactProcess(resumePid);
      for (const tab of terminalTabs) await closeCreatedTerminalTab(tab);
      if (fs.existsSync(run.rootDir) && process.env.ROVER_E2E_KEEP_TEMP !== '1') {
        removeM1E2ERun(run);
      }
    }
  });
});
