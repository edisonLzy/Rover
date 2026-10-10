import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import treeKill from 'tree-kill';
import { UserEnvResolver } from '../../../../../infrastructure/env/index.js';
import type { SafeRunnerOptions, SafeRunnerResult } from './types.js';

const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export const MAX_OUTPUT_BYTES = 30 * 1024; // 30 KB
export const MAX_OUTPUT_LINES = 500;
export const HEAD_LINES = 250;
export const TAIL_LINES = 100;
export const DEFAULT_TIMEOUT_MS = 30000;
export const MAX_TIMEOUT_MS = 120000;
export const MIN_TIMEOUT_MS = 1000;

export function applyHeadTailTruncation(
  text: string,
  logPrefix = 'bash'
): { text: string; truncated: boolean; logPath?: string } {
  const byteLength = Buffer.byteLength(text, 'utf-8');
  const lines = text.split('\n');

  if (byteLength <= MAX_OUTPUT_BYTES && lines.length <= MAX_OUTPUT_LINES) {
    return { text, truncated: false };
  }

  const tmpDir = path.join(os.homedir(), '.rover', 'tmp');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {
    // ignore directory creation error
  }

  const randomId = crypto.randomBytes(4).toString('hex');
  const logPath = path.join(tmpDir, `${logPrefix}_${randomId}.log`);
  try {
    fs.writeFileSync(logPath, text, 'utf-8');
  } catch {
    // ignore log write failure
  }

  const head = lines.slice(0, HEAD_LINES).join('\n');
  const tail = lines.slice(-TAIL_LINES).join('\n');
  const truncatedLineCount = lines.length - (HEAD_LINES + TAIL_LINES);
  const truncatedKb = Math.round((byteLength / 1024) * 10) / 10;

  const notice = `[... Rover Output Guard: 截断 ${truncatedLineCount > 0 ? truncatedLineCount : 0} 行 (${truncatedKb} KB)。完整日志已保存至 ${logPath} ...]`;

  const truncatedText = `${head}\n\n${notice}\n\n${tail}`;
  return { text: truncatedText, truncated: true, logPath };
}

export class SafeRunner {
  public static async run(options: SafeRunnerOptions): Promise<SafeRunnerResult> {
    const { command, cwd } = options;
    const timeoutMs = Math.min(
      Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS),
      MAX_TIMEOUT_MS
    );

    const resolvedEnv = await UserEnvResolver.resolve();
    const effectiveCwd = cwd ? path.resolve(cwd) : process.cwd();
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');

    return new Promise((resolve, reject) => {
      let stdoutRaw = '';
      let stderrRaw = '';
      let timedOut = false;
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      let killTimer: NodeJS.Timeout | null = null;

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, ['-c', command], {
          cwd: effectiveCwd,
          env: resolvedEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
      } catch (err) {
        return reject(err);
      }

      const cleanupTimers = () => {
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
      };

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        cleanupTimers();

        const cleanStdout = stripAnsi(stdoutRaw);
        let cleanStderr = stripAnsi(stderrRaw);

        if (timedOut) {
          cleanStderr = cleanStderr
            ? `${cleanStderr}\nCommand timed out after ${timeoutMs}ms.`
            : `Command timed out after ${timeoutMs}ms.`;
        }

        const stdoutTruncation = applyHeadTailTruncation(cleanStdout, 'bash');
        let finalStderr = cleanStderr;
        let finalTruncated = stdoutTruncation.truncated;
        let finalLogPath = stdoutTruncation.logPath;

        if (
          Buffer.byteLength(finalStderr, 'utf-8') > MAX_OUTPUT_BYTES ||
          finalStderr.split('\n').length > MAX_OUTPUT_LINES
        ) {
          const stderrTruncation = applyHeadTailTruncation(finalStderr, 'bash_stderr');
          finalStderr = stderrTruncation.text;
          finalTruncated = true;
          finalLogPath = finalLogPath || stderrTruncation.logPath;
        }

        resolve({
          stdout: stdoutTruncation.text,
          stderr: finalStderr,
          exitCode: timedOut ? 124 : exitCode,
          truncated: finalTruncated,
          logPath: finalLogPath,
        });
      };

      timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          treeKill(child.pid, 'SIGTERM');
        }

        killTimer = setTimeout(() => {
          if (child.pid) {
            treeKill(child.pid, 'SIGKILL');
          }
          finish(124);
        }, 3000);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutRaw += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrRaw += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        if (settled) return;
        cleanupTimers();
        reject(err);
      });

      child.on('close', (code) => {
        finish(code ?? 0);
      });
    });
  }
}
