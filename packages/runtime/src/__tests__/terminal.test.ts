import { describe, it, expect, vi } from 'vitest';
import {
  resolveTerminalAction,
  resolveDefaultTerminalApp,
  generateTerminalAppleScript,
  formatActionShellCommand,
  executeTerminalAction,
  type SessionCarrier,
  type CarrierSessionInfo,
  type TerminalAction,
} from '../index.js';

describe('Terminal.app Automation & Takeover/Resume (M1-4)', () => {
  const mockCarrierWithSession = (session: CarrierSessionInfo | null): SessionCarrier => ({
    carrierType: 'screen',
    startSession: vi.fn(),
    getSessionInfo: vi.fn().mockResolvedValue(session),
    getSession: vi.fn().mockResolvedValue(session),
    listSessions: vi.fn().mockResolvedValue(session ? [session] : []),
    killSession: vi.fn().mockResolvedValue(true),
    stopSession: vi.fn().mockResolvedValue(true),
  });

  describe('resolveTerminalAction', () => {
    it('resolves to attach action when screen session is active (detached)', async () => {
      const carrier = mockCarrierWithSession({
        attemptId: 'att_live_01',
        sessionName: 'rover_att_live_01',
        status: 'detached',
        pid: 1234,
        carrierType: 'screen',
      });

      const action = await resolveTerminalAction({
        attemptId: 'att_live_01',
        agentType: 'claude',
        nativeSessionId: '990ee48b-3e2b-426b-bfdc-b620ee6d41dc',
        cwd: '/Users/test/project',
        carrier,
      });

      expect(action.type).toBe('attach');
      expect(action.command).toBe('screen');
      expect(action.args).toEqual(['-r', 'rover_att_live_01']);
      expect(action.cwd).toBe('/Users/test/project');
    });

    it('resolves to claude resume action when screen session has exited', async () => {
      const carrier = mockCarrierWithSession(null);

      const action = await resolveTerminalAction({
        attemptId: 'att_done_01',
        agentType: 'claude',
        nativeSessionId: '990ee48b-3e2b-426b-bfdc-b620ee6d41dc',
        cwd: '/Users/test/project',
        carrier,
      });

      expect(action.type).toBe('resume');
      expect(action.command).toContain('claude');
      expect(action.args).toEqual([
        '--dangerously-skip-permissions',
        '--resume',
        '990ee48b-3e2b-426b-bfdc-b620ee6d41dc',
      ]);
    });

    it('resolves to codex resume action when screen session has exited', async () => {
      const carrier = mockCarrierWithSession(null);

      const action = await resolveTerminalAction({
        attemptId: 'att_done_02',
        agentType: 'codex',
        nativeSessionId: 'sess_codex_7788',
        cwd: '/Users/test/codex-proj',
        carrier,
      });

      expect(action.type).toBe('resume');
      expect(action.command).toContain('codex');
      expect(action.args).toEqual([
        'resume',
        '--dangerously-bypass-approvals-and-sandbox',
        'sess_codex_7788',
      ]);
    });

    it('throws error if session has exited but nativeSessionId is missing', async () => {
      const carrier = mockCarrierWithSession(null);

      await expect(
        resolveTerminalAction({
          attemptId: 'att_missing_id',
          agentType: 'codex',
          carrier,
        })
      ).rejects.toThrow('native session ID is missing');
    });
  });

  describe('AppleScript formatting & Shell escaping', () => {
    it('formats shell command with cwd and quoted arguments', () => {
      const action: TerminalAction = {
        type: 'resume',
        attemptId: 'att_01',
        sessionName: 'rover_att_01',
        command: 'claude',
        args: ['--resume', 'session with spaces'],
        cwd: '/Users/test/path with "quotes"',
        agentType: 'claude',
      };

      const shellCmd = formatActionShellCommand(action);
      expect(shellCmd).toContain('cd \'/Users/test/path with "quotes"\'');
      expect(shellCmd).toContain("'claude' '--resume' 'session with spaces'");
    });

    it('generates valid AppleScript telling Terminal.app to activate and do script', () => {
      const action: TerminalAction = {
        type: 'attach',
        attemptId: 'att_attach',
        sessionName: 'rover_att_attach',
        command: 'screen',
        args: ['-r', 'rover_att_attach'],
        agentType: 'codex',
      };

      const script = generateTerminalAppleScript(action);
      expect(script).toContain('tell application "Terminal"');
      expect(script).toContain('activate');
      expect(script).toContain("do script \"'screen' '-r' 'rover_att_attach'\"");
      expect(script).toContain('end tell');
    });
  });

  describe('executeTerminalAction', () => {
    it('handles successful AppleScript execution with custom runner', async () => {
      const action: TerminalAction = {
        type: 'attach',
        attemptId: 'att_01',
        sessionName: 'rover_att_01',
        command: 'screen',
        args: ['-r', 'rover_att_01'],
        agentType: 'claude',
      };

      const customRunner = vi.fn().mockResolvedValue('tab 1 of window 1\n');
      const result = await executeTerminalAction(action, customRunner, async () => 'Terminal');

      expect(result.success).toBe(true);
      expect(result.output).toBe('tab 1 of window 1');
      expect(customRunner).toHaveBeenCalled();
    });

    it('detects Apple Events permission error (-1743) and translates to guidance message', async () => {
      const action: TerminalAction = {
        type: 'attach',
        attemptId: 'att_01',
        sessionName: 'rover_att_01',
        command: 'screen',
        args: ['-r', 'rover_att_01'],
        agentType: 'claude',
      };

      const permissionErrorRunner = vi
        .fn()
        .mockRejectedValue(
          new Error('execution error: Not authorized to send Apple events to Terminal. (-1743)')
        );

      const result = await executeTerminalAction(
        action,
        permissionErrorRunner,
        async () => 'Terminal'
      );

      expect(result.success).toBe(false);
      expect(result.permissionDenied).toBe(true);
      expect(result.error).toContain(
        'Terminal.app automation permission denied (Apple Events error -1743)'
      );
      expect(result.error).toContain('System Settings > Privacy & Security > Automation');
    });
  });
});

describe('Default terminal routing', () => {
  it('uses the macOS default terminal', async () => {
    expect(await resolveDefaultTerminalApp(async () => 'com.googlecode.iterm2')).toBe('iTerm2');
    expect(await resolveDefaultTerminalApp(async () => 'com.apple.Terminal')).toBe('Terminal');
    await expect(resolveDefaultTerminalApp(async () => 'unknown.app')).rejects.toThrow('暂不支持');
  });
  it('routes iTerm attach and resume into a fresh shell without reusing a busy session', async () => {
    const action: TerminalAction = {
      type: 'attach',
      attemptId: 'a',
      sessionName: 'rover_a',
      command: '/path with spaces/agent',
      args: ['--resume', "id'with$()`quotes"],
      cwd: '/project with spaces',
      agentType: 'claude',
    };
    const runner = vi.fn(async () => 'window 1');
    const result = await executeTerminalAction(action, runner, async () => 'iTerm2');
    expect(result.success).toBe(true);
    expect(result.script).toContain('tell application id "com.googlecode.iterm2"');
    expect(result.script).toContain('create window with default profile');
    expect(result.script).toContain('write text');
    expect(formatActionShellCommand(action)).toContain("'/path with spaces/agent'");
    const failure = await executeTerminalAction(
      action,
      async () => {
        throw new Error('-1743');
      },
      async () => 'iTerm2'
    );
    expect(failure.error).toContain('iTerm2 automation permission denied');
  });
});
