import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const SENTINEL_START = '__ROVER_ENV_START__';
export const SENTINEL_END = '__ROVER_ENV_END__';
export const PROBE_TIMEOUT_MS = 2000;

export function getDefaultMacFallbackPaths(homeDir: string = os.homedir()): string[] {
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(homeDir, '.local/bin'),
    path.join(homeDir, '.cargo/bin'),
  ];
}

export const DEFAULT_MAC_FALLBACK_PATHS = getDefaultMacFallbackPaths();

export const SANITIZED_ENV_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  CI: '1',
  TERM: 'dumb',
  DEBIAN_FRONTEND: 'noninteractive',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
});

export function mergePaths(
  existingPath: string | undefined,
  fallbackPaths: readonly string[]
): string {
  const existingParts = existingPath ? existingPath.split(path.delimiter).filter(Boolean) : [];
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const part of [...existingParts, ...fallbackPaths]) {
    if (!seen.has(part)) {
      seen.add(part);
      merged.push(part);
    }
  }

  return merged.join(path.delimiter);
}

function getCleanProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return env;
}

export function parseEnvOutput(output: string): Record<string, string> {
  const startIndex = output.indexOf(SENTINEL_START);
  const endIndex = output.indexOf(SENTINEL_END, startIndex);
  if (startIndex === -1 || endIndex === -1) {
    return {};
  }

  const content = output.slice(startIndex + SENTINEL_START.length, endIndex);
  const lines = content.split('\n');
  const result: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx);
      const val = line.slice(eqIdx + 1);
      result[key] = val;
    }
  }

  return result;
}

export class UserEnvResolver {
  private static cachedEnv: Record<string, string> | null = null;
  private static resolvingPromise: Promise<Record<string, string>> | null = null;

  public static async resolve(options?: {
    forceRefresh?: boolean;
  }): Promise<Record<string, string>> {
    if (!options?.forceRefresh && this.cachedEnv) {
      return this.cachedEnv;
    }

    if (!options?.forceRefresh && this.resolvingPromise) {
      return this.resolvingPromise;
    }

    this.resolvingPromise = this.doResolve();
    try {
      this.cachedEnv = await this.resolvingPromise;
      if (this.cachedEnv.PATH) {
        process.env.PATH = this.cachedEnv.PATH;
      }
      return this.cachedEnv;
    } finally {
      this.resolvingPromise = null;
    }
  }

  public static getCached(): Record<string, string> | null {
    return this.cachedEnv;
  }

  public static resetCache(): void {
    this.cachedEnv = null;
    this.resolvingPromise = null;
  }

  private static async doResolve(): Promise<Record<string, string>> {
    const baseEnv = getCleanProcessEnv();

    if (process.platform !== 'darwin') {
      return {
        ...baseEnv,
        ...SANITIZED_ENV_OVERRIDES,
      };
    }

    const probed = await this.probeDarwinShellEnv();
    const mergedPath = mergePaths(probed.PATH || baseEnv.PATH, DEFAULT_MAC_FALLBACK_PATHS);

    return {
      ...baseEnv,
      ...probed,
      PATH: mergedPath,
      ...SANITIZED_ENV_OVERRIDES,
    };
  }

  private static probeDarwinShellEnv(): Promise<Record<string, string>> {
    return new Promise((resolve) => {
      const shell = process.env.SHELL || '/bin/zsh';
      const command = `echo "${SENTINEL_START}"; env; echo "${SENTINEL_END}"`;

      let stdout = '';
      let timer: NodeJS.Timeout | null = null;
      let finished = false;

      const safeFinish = (parsed: Record<string, string>) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        resolve(parsed);
      };

      try {
        const child = spawn(shell, ['-i', '-l', '-c', command], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          safeFinish({});
        }, PROBE_TIMEOUT_MS);

        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf-8');
        });

        child.on('error', () => {
          safeFinish({});
        });

        child.on('close', () => {
          const parsed = parseEnvOutput(stdout);
          safeFinish(parsed);
        });
      } catch {
        safeFinish({});
      }
    });
  }
}
