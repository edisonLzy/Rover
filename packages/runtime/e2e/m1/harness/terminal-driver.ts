import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  executeTerminalAction,
  type TerminalAction,
  type TerminalExecutionResult,
} from '../../../src/index.js';
import { pollUntil } from './polling.js';

const execFileAsync = promisify(execFile);
const TERMINAL_TAB_REFERENCE = /^tab \d+ of window (?:id )?\d+$/;

export async function executeRealTerminalAction(
  action: TerminalAction
): Promise<TerminalExecutionResult> {
  const result = await executeTerminalAction(action);
  if (!result.success) {
    throw new Error(result.error || 'Terminal.app automation failed without an error message.');
  }
  return result;
}

export async function closeCreatedTerminalTab(output?: string): Promise<void> {
  const tabReference = output?.trim();
  if (!tabReference || !TERMINAL_TAB_REFERENCE.test(tabReference)) {
    return;
  }

  const script = [
    'tell application "Terminal"',
    `  try`,
    `    close ${tabReference}`,
    '  end try',
    'end tell',
  ].join('\n');
  await execFileAsync('/usr/bin/osascript', ['-e', script]).catch(() => undefined);
}

export function readPidFile(pidPath: string): number | undefined {
  if (!fs.existsSync(pidPath)) return undefined;
  const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
}

export async function waitForPidFile(pidPath: string, timeoutMs = 30_000): Promise<number> {
  return pollUntil(() => readPidFile(pidPath) ?? null, {
    description: `CLI PID file ${pidPath}`,
    timeoutMs,
  });
}

export function terminateExactProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
  }
}
