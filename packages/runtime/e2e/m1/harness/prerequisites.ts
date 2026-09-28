import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RealAgentType } from './types.js';

const execFileAsync = promisify(execFile);

export interface M1E2EEnvironment {
  platform: NodeJS.Platform;
  architecture: string;
  macosVersion: string;
  screenPath: string;
  osascriptPath: string;
  claudePath: string;
  claudeVersion: string;
  codexPath: string;
  codexVersion: string;
  helperPath: string;
}

async function commandOutput(command: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    encoding: 'utf8',
    timeout: 15_000,
  });
  return `${stdout}${stderr}`.trim();
}

export async function resolveExecutable(command: string): Promise<string> {
  if (path.isAbsolute(command) && fs.existsSync(command)) {
    return command;
  }

  try {
    const resolved = await commandOutput('/usr/bin/which', [command]);
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Converted to a stable prerequisite error below.
  }

  throw new Error(`M1 real-CLI E2E prerequisite is missing: executable "${command}".`);
}

export function requireRealE2EOptIn(): void {
  if (process.env.ROVER_E2E_REAL_CLI !== '1') {
    throw new Error(
      'Real CLI E2E is opt-in. Re-run with ROVER_E2E_REAL_CLI=1; it creates real Claude/Codex sessions and opens Terminal.app.'
    );
  }
}

export async function inspectM1E2EEnvironment(): Promise<M1E2EEnvironment> {
  requireRealE2EOptIn();

  if (process.platform !== 'darwin') {
    throw new Error(`M1 real-CLI E2E requires macOS; current platform is ${process.platform}.`);
  }

  const [screenPath, osascriptPath, claudePath, codexPath] = await Promise.all([
    resolveExecutable('/usr/bin/screen'),
    resolveExecutable('/usr/bin/osascript'),
    resolveExecutable(process.env.ROVER_E2E_CLAUDE_PATH || 'claude'),
    resolveExecutable(process.env.ROVER_E2E_CODEX_PATH || 'codex'),
  ]);

  const helperPath = path.resolve(process.cwd(), '../app/src-tauri/target/debug/rover-hook-helper');
  if (!fs.existsSync(helperPath)) {
    throw new Error(
      `rover-hook-helper was not built at ${helperPath}. Use the package test:e2e:m1 script.`
    );
  }

  const [macosVersion, claudeVersion, codexVersion, claudeAuth, codexAuth] = await Promise.all([
    commandOutput('/usr/bin/sw_vers', ['-productVersion']),
    commandOutput(claudePath, ['--version']),
    commandOutput(codexPath, ['--version']),
    commandOutput(claudePath, ['auth', 'status']),
    commandOutput(codexPath, ['login', 'status']),
  ]);

  if (!claudeAuth.includes('"loggedIn": true')) {
    throw new Error(`Claude Code is not logged in. auth status: ${claudeAuth}`);
  }
  if (!codexAuth.toLowerCase().includes('logged in')) {
    throw new Error(`Codex CLI is not logged in. login status: ${codexAuth}`);
  }

  await commandOutput(osascriptPath, ['-e', 'tell application "Terminal" to get name']);

  return {
    platform: process.platform,
    architecture: os.arch(),
    macosVersion,
    screenPath,
    osascriptPath,
    claudePath,
    claudeVersion,
    codexPath,
    codexVersion,
    helperPath,
  };
}

export async function resolveAgentPath(agentType: RealAgentType): Promise<string> {
  const configured =
    agentType === 'claude'
      ? process.env.ROVER_E2E_CLAUDE_PATH || 'claude'
      : process.env.ROVER_E2E_CODEX_PATH || 'codex';
  return resolveExecutable(configured);
}
