import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  getScreenSessionInfo,
  killScreenSession,
  type ScreenSessionInfo,
} from '../../../src/index.js';
import { pollUntil } from './polling.js';

const execFileAsync = promisify(execFile);

export async function waitForScreenStatus(
  attemptId: string,
  status: ScreenSessionInfo['status'],
  timeoutMs = 30_000
): Promise<ScreenSessionInfo> {
  return pollUntil(
    async () => {
      const session = await getScreenSessionInfo(attemptId);
      return session?.status === status ? session : null;
    },
    { description: `Screen session ${attemptId} to become ${status}`, timeoutMs }
  );
}

export async function waitForScreenExit(attemptId: string, timeoutMs = 30_000): Promise<true> {
  return pollUntil(async () => ((await getScreenSessionInfo(attemptId)) === null ? true : null), {
    description: `Screen session ${attemptId} to exit`,
    timeoutMs,
  });
}

export async function detachScreenSession(sessionName: string): Promise<void> {
  await execFileAsync('/usr/bin/screen', ['-S', sessionName, '-X', 'detach']);
}

export async function sendScreenInput(sessionName: string, input: string): Promise<void> {
  await execFileAsync('/usr/bin/screen', ['-S', sessionName, '-p', '0', '-X', 'stuff', input]);
}

export async function cleanupScreenSession(attemptId: string): Promise<void> {
  await killScreenSession(attemptId).catch(() => false);
}
