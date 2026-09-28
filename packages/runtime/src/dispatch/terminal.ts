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

  const cmdParts = [action.command, ...action.args.map(escapeShellArg)];
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
export function generateTerminalAppleScript(action: TerminalAction): string {
  const shellCommand = formatActionShellCommand(action);
  const escapedCommand = escapeAppleScriptString(shellCommand);

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
  customRunner?: (script: string) => Promise<string>
): Promise<TerminalExecutionResult> {
  const script = generateTerminalAppleScript(action);

  try {
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
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const isPermissionDenied =
      errMsg.includes('-1743') ||
      errMsg.toLowerCase().includes('not authorized') ||
      errMsg.toLowerCase().includes('not permitted');

    const formattedError = isPermissionDenied
      ? 'Terminal.app automation permission denied (Apple Events error -1743). Please grant Automation permission in macOS System Settings > Privacy & Security > Automation.'
      : `Failed to automate Terminal.app: ${errMsg}`;

    return {
      success: false,
      action,
      script,
      error: formattedError,
      permissionDenied: isPermissionDenied,
    };
  }
}
