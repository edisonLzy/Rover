import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DispatchAttempt } from '../../../src/index.js';
import type { LauncherPayload, M1E2ERun } from './types.js';

const execFileAsync = promisify(execFile);

export async function launchDispatchInShortLivedProcess(
  run: M1E2ERun,
  payload: LauncherPayload
): Promise<DispatchAttempt> {
  const inputPath = path.join(run.rootDir, 'launcher-input.json');
  const outputPath = path.join(run.rootDir, 'launcher-output.json');
  const launcherPath = path.resolve(process.cwd(), 'e2e/m1/fixtures/launch-dispatch.mjs');

  fs.writeFileSync(inputPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });

  await execFileAsync(process.execPath, [launcherPath, inputPath, outputPath], {
    cwd: process.cwd(),
    timeout: 30_000,
    env: process.env,
  });

  if (!fs.existsSync(outputPath)) {
    throw new Error('Short-lived launcher exited without writing its dispatch result.');
  }

  return JSON.parse(fs.readFileSync(outputPath, 'utf8')) as DispatchAttempt;
}
