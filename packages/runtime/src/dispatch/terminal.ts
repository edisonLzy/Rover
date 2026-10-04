/**
 * macOS Terminal.app Automation & Takeover/Resume Service.
 *
 * Implements TRD Section 5 & M1 Milestone specifications:
 * - Detects live Screen carrier state to decide between 'attach' and 'resume'.
 * - If Screen session is active/detached: generates `screen -r rover_<attemptId>`.
 * - If Screen session has exited/completed: generates native CLI resume command
 *   (e.g., `claude --resume <UUID>`, `codex resume <ID>`).
 * - Formats safe AppleScript commands for Terminal.app automation.
 * - Detects macOS Apple Events / Automation permission denials and provides actionable repair instructions.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentType, LaunchSpec } from './types.js';
import type { SessionCarrier } from './carrier.js';
import { getSessionName } from './screen.js';
import { defaultAgentRegistry, type AgentRegistry } from './dispatcher.js';

const execFileAsync = promisify(execFile);

export type TerminalActionType = 'attach' | 'resume';

export interface TerminalAction {
  type: TerminalActionType;
  attemptId: string;
  sessionName: string;
  command: string;
  args: string[];
  cwd?: string;
  agentType: AgentType;
  nativeSessionId?: string;
}

export interface ResolveTerminalActionOptions {
  attemptId: string;
  agentType: AgentType;
  nativeSessionId?: string;
  cwd?: string;
  carrier: SessionCarrier;
  registry?: AgentRegistry;
}

/**
 * Resolves the appropriate Terminal.app action ('attach' vs 'resume') based on current carrier state.
 */
export async function resolveTerminalAction(
  options: ResolveTerminalActionOptions
): Promise<TerminalAction> {
  const {
    attemptId,
    agentType,
    nativeSessionId,
    cwd,
    carrier,
    registry = defaultAgentRegistry,
  } = options;

  const sessionName = getSessionName(attemptId);
  const existingSession =
    typeof carrier.getSession === 'function'
      ? await carrier.getSession(attemptId)
      : await carrier.getSessionInfo(attemptId);

  // If Screen session is still active (detached or attached), attach to it directly
  if (
    existingSession &&
    (existingSession.status === 'detached' || existingSession.status === 'attached')
  ) {
    return {
      type: 'attach',
      attemptId,
      sessionName,
      command: 'screen',
      args: ['-r', sessionName],
      cwd,
      agentType,
      nativeSessionId,
    };
  }

  // Otherwise, the session has completed or exited. We must resume via native CLI
  if (!nativeSessionId || !nativeSessionId.trim()) {
    throw new Error(
      `Cannot construct resume action for attempt "${attemptId}": native session ID is missing.`
    );
  }

  const adapter = registry.get(agentType);
  const resumeSpec: LaunchSpec = await adapter.getResumeSpec(nativeSessionId.trim());

  return {
    type: 'resume',
    attemptId,
    sessionName,
    command: resumeSpec.command,
    args: resumeSpec.args,
    cwd: cwd || resumeSpec.cwd,
    agentType,
    nativeSessionId: nativeSessionId.trim(),
  };
}

/**
 * Safely escapes a single shell argument with single quotes.
 */
export function escapeShellArg(arg: string): string {
  if (!arg) return "''";
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Formats a TerminalAction into an executable shell line.
 */
export function formatActionShellCommand(action: TerminalAction): string {
  const parts: string[] = [];

  if (action.cwd && action.cwd.trim()) {
    parts.push(`cd ${escapeShellArg(action.cwd.trim())}`);
  }

  const cmdParts = [escapeShellArg(action.command), ...action.args.map(escapeShellArg)];
  parts.push(cmdParts.join(' '));

  return parts.join(' && ');
}

/**
 * Escapes characters for an AppleScript string literal.
 */
export function escapeAppleScriptString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generates an AppleScript payload to launch or focus Terminal.app and execute the action.
 */
export type TerminalApp = 'Terminal' | 'iTerm2';

/** Resolve the macOS default terminal (Unix executable Shell role), without opening a window. */
export async function resolveDefaultTerminalApp(
  readBundleId: () => Promise<string> = readDefaultTerminalBundleId
): Promise<TerminalApp> {
  const id = (await readBundleId()).trim();
  if (id === 'com.googlecode.iterm2') return 'iTerm2';
  if (id === 'com.apple.Terminal') return 'Terminal';
  throw new Error(`默认终端 ${id} 暂不支持，请将系统默认终端设为 iTerm2 或 Terminal。`);
}

async function readDefaultTerminalBundleId(): Promise<string> {
  const { stdout } = await execFileAsync('osascript', [
    '-l',
    'JavaScript',
    '-e',
    [
      'ObjC.import("CoreServices");',
      // CFStringRef is toll-free bridged to NSString; bind as id for the JXA bridge.
      'ObjC.bindFunction("LSCopyDefaultRoleHandlerForContentType", ["id", ["id", "unsigned int"]]);',
      // kLSRolesShell = 1 << 3. This is the same preference used by iTerm's Make Default action.
      'ObjC.unwrap($.LSCopyDefaultRoleHandlerForContentType($("public.unix-executable"), 8)) || "com.apple.Terminal";',
    ].join('\n'),
  ]);
  return stdout.trim();
}

export function generateTerminalAppleScript(
  action: TerminalAction,
  app: TerminalApp = 'Terminal'
): string {
  const shellCommand = formatActionShellCommand(action);
  const escapedCommand = escapeAppleScriptString(shellCommand);

  if (app === 'iTerm2') {
    return [
      'tell application id "com.googlecode.iterm2"',
      '    activate',
      '    set sessionWindow to (create window with default profile)',
      '    tell current session of sessionWindow',
      `        write text "${escapedCommand}"`,
      '    end tell',
      'end tell',
    ].join('\n');
  }

  return [
    'tell application "Terminal"',
    '    activate',
    `    do script "${escapedCommand}"`,
    'end tell',
  ].join('\n');
}

export interface TerminalExecutionResult {
  success: boolean;
  action: TerminalAction;
  script: string;
  output?: string;
  error?: string;
  permissionDenied?: boolean;
}

/**
 * Executes a TerminalAction on macOS via osascript.
 */
export async function executeTerminalAction(
  action: TerminalAction,
  customRunner?: (script: string) => Promise<string>,
  resolveApp: () => Promise<TerminalApp> = resolveDefaultTerminalApp
): Promise<TerminalExecutionResult> {
  let app: TerminalApp = 'Terminal';
  let script = '';
  try {
    app = await resolveApp();
    script = generateTerminalAppleScript(action, app);
    let output = '';
    if (customRunner) {
      output = await customRunner(script);
    } else {
      const { stdout } = await execFileAsync('osascript', ['-e', script]);
      output = stdout;
    }

    return {
      success: true,
      action,
      script,
      output: output.trim(),
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isPermissionDenied =
      errMsg.includes('-1743') ||
      errMsg.toLowerCase().includes('not authorized') ||
      errMsg.toLowerCase().includes('not permitted');

    const formattedError = isPermissionDenied
      ? `${app === 'Terminal' ? 'Terminal.app' : app} automation permission denied (Apple Events error -1743). Please grant Automation permission in macOS System Settings > Privacy & Security > Automation.`
      : `Failed to open default terminal: ${errMsg}`;

    return {
      success: false,
      action,
      script,
      error: formattedError,
      permissionDenied: isPermissionDenied,
    };
  }
}
