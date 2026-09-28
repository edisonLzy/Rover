/**
 * GNU Screen background session carrier and supervisor.
 *
 * Implements TRD Section 5:
 * Starts Code Agent CLI in a detached GNU Screen session using an argument array.
 * Strictly avoids shell string concatenation to prevent prompt injection.
 * Injects ROVER_DISPATCH_ATTEMPT_ID and capability tokens into child environment.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

export type ScreenSessionStatus = 'detached' | 'attached' | 'dead' | 'unknown';

export interface ScreenSessionInfo {
  attemptId: string;
  sessionName: string;
  pid: number | null;
  status: ScreenSessionStatus;
}

export interface StartScreenOptions {
  attemptId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  reportToken?: string;
  screenBinary?: string;
}

const DEFAULT_SCREEN_BIN = '/usr/bin/screen';
const VALID_ATTEMPT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates that an attemptId contains only safe identifier characters.
 */
export function validateAttemptId(attemptId: string): void {
  if (!attemptId || !VALID_ATTEMPT_ID_REGEX.test(attemptId)) {
    throw new Error(
      `Invalid attempt ID: "${attemptId}". Must match ${VALID_ATTEMPT_ID_REGEX.source}`
    );
  }
}

/**
 * Constructs the canonical Screen session name for an attempt ID.
 */
export function getSessionName(attemptId: string): string {
  validateAttemptId(attemptId);
  return `rover_${attemptId}`;
}

/**
 * Parses the text output of `screen -ls` into an array of ScreenSessionInfo for Rover sessions.
 */
export function parseScreenListOutput(output: string): ScreenSessionInfo[] {
  const sessions: ScreenSessionInfo[] = [];
  const lines = output.split('\n');
  const lineRegex = /^\s*(\d+)\.(rover_([a-zA-Z0-9_-]+))\s+\(([^)]+)\)/;

  for (const line of lines) {
    const match = lineRegex.exec(line);
    if (!match) continue;

    const pid = Number.parseInt(match[1], 10);
    const sessionName = match[2];
    const attemptId = match[3];
    const rawFlags = match[4].toLowerCase();

    let status: ScreenSessionStatus = 'unknown';
    if (rawFlags.includes('detached')) {
      status = 'detached';
    } else if (rawFlags.includes('attached')) {
      status = 'attached';
    } else if (rawFlags.includes('dead')) {
      status = 'dead';
    }

    sessions.push({
      attemptId,
      sessionName,
      pid: Number.isNaN(pid) ? null : pid,
      status,
    });
  }

  return sessions;
}

/**
 * Retrieves the status of a specific Rover screen session by attempt ID.
 * Returns null if the session is not found in the screen list.
 */
export async function getScreenSessionInfo(
  attemptId: string,
  screenBinary: string = DEFAULT_SCREEN_BIN
): Promise<ScreenSessionInfo | null> {
  validateAttemptId(attemptId);
  const targetSessionName = getSessionName(attemptId);
  const allSessions = await listRoverScreenSessions(screenBinary);

  return allSessions.find((s) => s.sessionName === targetSessionName) ?? null;
}

/**
 * Lists all running or existing Rover GNU Screen sessions.
 */
export async function listRoverScreenSessions(
  screenBinary: string = DEFAULT_SCREEN_BIN
): Promise<ScreenSessionInfo[]> {
  return new Promise((resolve) => {
    const child = spawn(screenBinary, ['-ls'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('close', () => {
      resolve(parseScreenListOutput(output));
    });

    child.on('error', () => {
      // If screen binary cannot be run, return empty list
      resolve([]);
    });
  });
}

/**
 * Starts a command inside a detached GNU Screen session.
 *
 * Guaranteed invariants:
 * 1. Strictly uses parameter array invocation without shell wrapping.
 * 2. Injects ROVER_DISPATCH_ATTEMPT_ID and optional ROVER_REPORT_TOKEN.
 * 3. Detached from Node process lifecycle so it survives Node exit.
 */
export async function startScreenSession(options: StartScreenOptions): Promise<ScreenSessionInfo> {
  const {
    attemptId,
    command,
    args = [],
    cwd,
    env = {},
    reportToken,
    screenBinary = DEFAULT_SCREEN_BIN,
  } = options;

  validateAttemptId(attemptId);
  const sessionName = getSessionName(attemptId);

  // Check if a session with this name is already active
  const existing = await getScreenSessionInfo(attemptId, screenBinary);
  if (existing && (existing.status === 'detached' || existing.status === 'attached')) {
    throw new Error(
      `A screen session for attempt "${attemptId}" is already active (PID: ${existing.pid}, Status: ${existing.status}).`
    );
  }

  // Construct environment variables with UTF-8 locale and 256color terminal support
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    LANG: process.env.LANG || 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
    TERM: process.env.TERM || 'xterm-256color',
    ...env,
    ROVER_DISPATCH_ATTEMPT_ID: attemptId,
  };

  if (reportToken) {
    childEnv.ROVER_REPORT_TOKEN = reportToken;
  }

  // Parameter array: screen -U -dmS <session_name> <command> [args...]
  // -U forces GNU Screen into UTF-8 mode to properly render CJK characters, spinners, and emojis
  const screenArgs = ['-U', '-dmS', sessionName, command, ...args];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(screenBinary, screenArgs, {
      cwd,
      env: childEnv,
      stdio: 'ignore',
      detached: true,
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn screen process: ${err.message}`));
    });

    // Unref child process so Node event loop does not keep running for screen launcher
    child.unref();

    // Allow screen socket initialization and detect immediate exits
    setTimeout(resolve, 150);
  });

  // Verify session registered in screen list and is actively running
  const created = await getScreenSessionInfo(attemptId, screenBinary);
  if (!created || (created.status !== 'detached' && created.status !== 'attached')) {
    throw new Error(
      `Screen session "${sessionName}" failed to start or terminated immediately upon launch.`
    );
  }

  return created;
}

/**
 * Sends a quit signal to terminate a specific screen session.
 * Note: Only for explicit cancellation or test cleanup.
 * Rover normal shutdown MUST NOT invoke this to preserve Code Agent sessions.
 */
export async function killScreenSession(
  attemptId: string,
  screenBinary: string = DEFAULT_SCREEN_BIN
): Promise<boolean> {
  validateAttemptId(attemptId);
  const sessionName = getSessionName(attemptId);

  return new Promise((resolve) => {
    const child = spawn(screenBinary, ['-S', sessionName, '-X', 'quit'], {
      stdio: 'ignore',
      env: process.env,
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Wipes dead GNU screen sockets.
 */
export async function wipeDeadScreenSessions(
  screenBinary: string = DEFAULT_SCREEN_BIN
): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(screenBinary, ['-wipe'], {
      stdio: 'ignore',
      env: process.env,
    });

    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}
