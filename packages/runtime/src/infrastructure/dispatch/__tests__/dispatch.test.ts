import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  AgentRegistry,
  ClaudeAdapter,
  CodexAdapter,
  OpenCodeAdapter,
  createDispatchAttempt,
  launchDispatch,
  confirmNativeSession,
  failDispatch,
  sessionCarrier,
} from '../index.js';

describe('Agent Dispatch & Session Binding (M1-2)', () => {
  describe('AgentRegistry', () => {
    it('registers and retrieves claude, codex, and opencode adapters', () => {
      const registry = new AgentRegistry();
      expect(registry.listRegisteredAgents()).toEqual(['claude', 'codex', 'opencode']);
      expect(registry.has('claude')).toBe(true);
      expect(registry.has('codex')).toBe(true);
      expect(registry.has('opencode')).toBe(true);

      expect(registry.get('claude')).toBeInstanceOf(ClaudeAdapter);
      expect(registry.get('codex')).toBeInstanceOf(CodexAdapter);
      expect(registry.get('opencode')).toBeInstanceOf(OpenCodeAdapter);
    });

    it('throws error for unsupported agent type', () => {
      const registry = new AgentRegistry();
      // @ts-expect-error testing invalid type
      expect(() => registry.get('unsupported')).toThrow(/Unsupported agent type/);
    });
  });

  describe('ClaudeAdapter', () => {
    const adapter = new ClaudeAdapter();

    it('enforces preallocated UUID strategy and constructs valid launch spec', async () => {
      const testUuid = crypto.randomUUID();
      const spec = await adapter.buildLaunchSpec(
        {
          agentType: 'claude',
          cwd: '/tmp/repo',
          prompt: 'Fix issue #123',
          extraArgs: ['--dangerously-skip-permissions', '--print'],
          extraEnv: { CUSTOM_VAR: 'hello' },
        },
        {
          attemptId: 'att_123',
          reportToken: 'token_abc',
          reservedTaskUuid: 'task_xyz',
          preallocatedSessionId: testUuid,
        }
      );

      expect(spec.cwd).toBe('/tmp/repo');
      expect(spec.args).not.toContain('--print');
      expect(spec.args.filter((arg) => arg === '--dangerously-skip-permissions')).toHaveLength(1);
      expect(spec.args).toContain('--session-id');
      expect(spec.args).toContain(testUuid);
      expect(spec.args).toContain('Fix issue #123');
      expect(spec.args).toContain('--dangerously-skip-permissions');
      expect(spec.env?.ROVER_DISPATCH_ATTEMPT_ID).toBe('att_123');
      expect(spec.env?.ROVER_REPORT_TOKEN).toBe('token_abc');
      expect(spec.env?.ROVER_RESERVED_TASK_UUID).toBe('task_xyz');
      expect(spec.env?.ROVER_AGENT_TYPE).toBe('claude');
      expect(spec.env?.CUSTOM_VAR).toBe('hello');
    });

    it('rejects invalid UUID or missing preallocated session ID', async () => {
      await expect(
        adapter.buildLaunchSpec(
          { agentType: 'claude', cwd: '/tmp/repo' },
          {
            attemptId: 'att_123',
            reportToken: 'token_abc',
            reservedTaskUuid: 'task_xyz',
            preallocatedSessionId: 'invalid-uuid-string',
          }
        )
      ).rejects.toThrow(/Invalid UUID/);

      await expect(
        adapter.buildLaunchSpec(
          { agentType: 'claude', cwd: '/tmp/repo' },
          {
            attemptId: 'att_123',
            reportToken: 'token_abc',
            reservedTaskUuid: 'task_xyz',
          }
        )
      ).rejects.toThrow(/requires a preallocated session UUID/);
    });

    it('constructs correct resume spec', async () => {
      const spec = await adapter.getResumeSpec('session-uuid-123');
      expect(spec.args).toEqual(['--dangerously-skip-permissions', '--resume', 'session-uuid-123']);
    });
  });

  describe('CodexAdapter', () => {
    const adapter = new CodexAdapter();

    it('constructs launch spec with -C cwd and deferred session strategy', async () => {
      expect(adapter.defaultSessionIdStrategy).toBe('deferred');

      const spec = await adapter.buildLaunchSpec(
        {
          agentType: 'codex',
          cwd: '/path/to/project',
          prompt: 'Run security audit',
          extraArgs: ['--model', 'o3'],
        },
        {
          attemptId: 'att_codex',
          reportToken: 'token_codex',
          reservedTaskUuid: 'task_codex',
        }
      );

      expect(spec.cwd).toBe('/path/to/project');
      expect(spec.args).toEqual([
        '--dangerously-bypass-approvals-and-sandbox',
        '-C',
        '/path/to/project',
        'Run security audit',
        '--model',
        'o3',
      ]);
      expect(spec.env?.ROVER_AGENT_TYPE).toBe('codex');
    });

    it('constructs correct resume spec', async () => {
      const spec = await adapter.getResumeSpec('codex_sess_999');
      expect(spec.args).toEqual([
        'resume',
        '--dangerously-bypass-approvals-and-sandbox',
        'codex_sess_999',
      ]);
    });
  });

  describe('OpenCodeAdapter', () => {
    const adapter = new OpenCodeAdapter();

    it('constructs launch spec supporting -s preallocated session and project directory', async () => {
      const testUuid = crypto.randomUUID();
      const spec = await adapter.buildLaunchSpec(
        {
          agentType: 'opencode',
          cwd: '/workspace/app',
          prompt: 'Refactor auth controller',
        },
        {
          attemptId: 'att_opencode',
          reportToken: 'token_opencode',
          reservedTaskUuid: 'task_opencode',
          preallocatedSessionId: testUuid,
        }
      );

      expect(spec.cwd).toBe('/workspace/app');
      expect(spec.args).toContain('-s');
      expect(spec.args).toContain(testUuid);
      expect(spec.args).toContain('--prompt');
      expect(spec.args).toContain('Refactor auth controller');
      expect(spec.args[spec.args.length - 1]).toBe('/workspace/app');
      expect(spec.env?.ROVER_AGENT_TYPE).toBe('opencode');
    });

    it('constructs correct resume spec', async () => {
      const spec = await adapter.getResumeSpec('opencode_sess_456');
      expect(spec.args).toEqual(['--auto', '-s', 'opencode_sess_456']);
    });
  });

  describe('Lifecycle & Domain Invariants', () => {
    it('creates attempt with preallocated UUID and capability tokens for Claude', () => {
      const attempt = createDispatchAttempt({
        agentType: 'claude',
        cwd: '/tmp/repo',
      });

      expect(attempt.status).toBe('pending');
      expect(attempt.attemptId).toMatch(/^att_[0-9a-f]{16}$/);
      expect(attempt.reservedTaskUuid).toBeTruthy();
      expect(attempt.reportToken).toHaveLength(48); // 24 bytes in hex
      expect(attempt.sessionIdStrategy).toBe('preallocated');
      expect(attempt.preallocatedSessionId).toBeTruthy();
    });

    it('creates attempt with deferred strategy for Codex', () => {
      const attempt = createDispatchAttempt({
        agentType: 'codex',
        cwd: '/tmp/repo',
      });

      expect(attempt.status).toBe('pending');
      expect(attempt.sessionIdStrategy).toBe('deferred');
      expect(attempt.preallocatedSessionId).toBeUndefined();
    });

    it('launches attempt through carrier and transitions state to launched', async () => {
      const attempt = createDispatchAttempt({
        agentType: 'claude',
        cwd: '/tmp/repo',
      });

      const startSpy = vi.spyOn(sessionCarrier, 'startSession').mockResolvedValueOnce({
        attemptId: attempt.attemptId,
        sessionName: `rover_${attempt.attemptId}`,
        pid: 12345,
        status: 'detached',
        carrierType: 'screen',
      });

      const { carrierSession } = await launchDispatch(attempt, {
        agentType: 'claude',
        cwd: '/tmp/repo',
      });

      expect(attempt.status).toBe('launched');
      expect(attempt.carrierSessionName).toBe(`rover_${attempt.attemptId}`);
      expect(carrierSession.pid).toBe(12345);
      expect(startSpy).toHaveBeenCalledTimes(1);
      startSpy.mockRestore();
    });

    it('fails attempt if carrier encounters error', async () => {
      const startSpy = vi
        .spyOn(sessionCarrier, 'startSession')
        .mockRejectedValueOnce(new Error('Screen process spawn failure'));

      const attempt = createDispatchAttempt({
        agentType: 'codex',
        cwd: '/tmp/repo',
      });

      await expect(
        launchDispatch(attempt, { agentType: 'codex', cwd: '/tmp/repo' })
      ).rejects.toThrow('Screen process spawn failure');

      expect(attempt.status).toBe('failed');
      expect(attempt.errorMessage).toBe('Screen process spawn failure');
      startSpy.mockRestore();
    });

    it('enforces native session confirmation invariants for preallocated sessions', () => {
      const attempt = createDispatchAttempt({
        agentType: 'claude',
        cwd: '/tmp/repo',
      });
      attempt.status = 'launched';

      // Mismatched session ID must be rejected (cross-session contamination defense)
      expect(() => confirmNativeSession(attempt, 'different-uuid')).toThrow(
        /Preallocated session mismatch/
      );

      // Matching session ID succeeds and yields SessionRefCandidate
      const candidate = confirmNativeSession(attempt, attempt.preallocatedSessionId!);
      expect(attempt.status).toBe('confirmed');
      expect(attempt.nativeSessionId).toBe(attempt.preallocatedSessionId);
      expect(candidate.nativeSessionId).toBe(attempt.preallocatedSessionId);
      expect(candidate.reservedTaskUuid).toBe(attempt.reservedTaskUuid);
    });

    it('allows deferred session confirmation upon receiving native ID (Codex)', () => {
      const attempt = createDispatchAttempt({
        agentType: 'codex',
        cwd: '/tmp/repo',
      });
      attempt.status = 'launched';

      const candidate = confirmNativeSession(attempt, 'dynamic_codex_session_789');
      expect(attempt.status).toBe('confirmed');
      expect(attempt.nativeSessionId).toBe('dynamic_codex_session_789');
      expect(candidate.nativeSessionId).toBe('dynamic_codex_session_789');
    });

    it('strictly prevents confirming unlaunched attempts or empty session IDs', () => {
      const pendingAttempt = createDispatchAttempt({
        agentType: 'claude',
        cwd: '/tmp/repo',
      });

      expect(() => confirmNativeSession(pendingAttempt, 'uuid')).toThrow(/must be 'launched'/);

      pendingAttempt.status = 'launched';
      expect(() => confirmNativeSession(pendingAttempt, '  ')).toThrow(/cannot be empty/);
    });

    it('marks attempt as failed using failDispatch', () => {
      const attempt = createDispatchAttempt({
        agentType: 'opencode',
        cwd: '/tmp/repo',
      });
      failDispatch(attempt, 'CLI executable timed out');
      expect(attempt.status).toBe('failed');
      expect(attempt.errorMessage).toBe('CLI executable timed out');
    });
  });
});
