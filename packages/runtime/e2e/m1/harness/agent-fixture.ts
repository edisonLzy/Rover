import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installClaudeHooks, installCodexHooks, type DispatchAttempt } from '../../../src/index.js';
import { resolveAgentPath } from './prerequisites.js';
import type { AgentFixture, M1E2ERun } from './types.js';

const execFileAsync = promisify(execFile);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function exportLine(name: string, value: string): string {
  return `export ${name}=${shellQuote(value)}`;
}

function copyPrivateFileIfPresent(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
}

function copyCodexAuthentication(targetHome: string): void {
  const sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sourceAuth = path.join(sourceHome, 'auth.json');
  if (!fs.existsSync(sourceAuth)) {
    throw new Error(
      `Codex authentication file is missing at ${sourceAuth}; run codex login before the E2E suite.`
    );
  }

  fs.mkdirSync(targetHome, { recursive: true });
  fs.copyFileSync(sourceAuth, path.join(targetHome, 'auth.json'));
  fs.chmodSync(path.join(targetHome, 'auth.json'), 0o600);

  // Preserve first-run/login metadata without copying session history or databases.
  copyPrivateFileIfPresent(
    path.join(sourceHome, '.codex-global-state.json'),
    path.join(targetHome, '.codex-global-state.json')
  );
  copyPrivateFileIfPresent(
    path.join(sourceHome, 'installation_id'),
    path.join(targetHome, 'installation_id')
  );
}

async function prepareCodexHome(targetHome: string, cliPath: string, cwd: string): Promise<void> {
  copyCodexAuthentication(targetHome);

  const { stdout } = await execFileAsync(cliPath, ['--version'], { encoding: 'utf8' });
  const version = stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
  if (!version) throw new Error(`Unable to determine Codex CLI version from: ${stdout.trim()}`);

  // Codex stores the project trust decision in its user config. Scope the trust to this
  // isolated CODEX_HOME so the real CLI can reach its TUI without an interactive trust prompt.
  // Include the git common worktree root because Codex may canonicalize linked worktrees to it.
  const { stdout: commonDir } = await execFileAsync(
    '/usr/bin/git',
    ['rev-parse', '--git-common-dir'],
    { cwd, encoding: 'utf8' }
  );
  const commonPath = path.resolve(cwd, commonDir.trim());
  const canonicalProjectRoot =
    path.basename(commonPath) === '.git' ? path.dirname(commonPath) : cwd;
  const trustedRoots = [...new Set([cwd, canonicalProjectRoot])];
  const config = trustedRoots
    .map((root) => `[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"`)
    .join('\n\n');
  fs.writeFileSync(path.join(targetHome, 'config.toml'), `${config}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  // Avoid an unrelated update-available overlay on this isolated TUI. Codex refreshes this
  // cache itself; seeding the installed version keeps first-run and resume tests deterministic.
  fs.writeFileSync(
    path.join(targetHome, 'version.json'),
    `${JSON.stringify({ latest_version: version, last_checked_at: new Date().toISOString(), dismissed_version: null })}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
}

export async function createAgentFixture(
  run: M1E2ERun,
  attempt: DispatchAttempt,
  includeRoverIdentity = true,
  hookHelperPath = run.helperPath
): Promise<AgentFixture> {
  const cliPath = await resolveAgentPath(run.agentType);
  const wrapperPath = path.join(run.rootDir, `${run.agentType}-e2e-wrapper.sh`);
  const launchPidPath = path.join(run.rootDir, `${run.agentType}-launch.pid`);
  const resumePidPath = path.join(run.rootDir, `${run.agentType}-resume.pid`);

  const environment = [
    exportLine('ROVER_SPOOL_DIR', run.spoolDir),
    exportLine('ROVER_HOOK_HELPER_PATH', hookHelperPath),
  ];

  if (includeRoverIdentity) {
    environment.push(
      exportLine('ROVER_DISPATCH_ATTEMPT_ID', attempt.attemptId),
      exportLine('ROVER_REPORT_TOKEN', attempt.reportToken),
      exportLine('ROVER_RESERVED_TASK_UUID', attempt.reservedTaskUuid),
      exportLine('ROVER_AGENT_TYPE', run.agentType)
    );
  } else {
    environment.push(
      'unset ROVER_DISPATCH_ATTEMPT_ID',
      'unset ROVER_REPORT_TOKEN',
      'unset ROVER_RESERVED_TASK_UUID',
      'unset ROVER_AGENT_TYPE'
    );
  }

  let command: string;
  let environmentOverride: AgentFixture['environmentOverride'];

  if (run.agentType === 'claude') {
    const claudeHome = path.join(run.rootDir, 'claude-home');
    const settingsPath = path.join(claudeHome, 'settings.json');
    fs.mkdirSync(claudeHome, { recursive: true });
    installClaudeHooks(settingsPath, hookHelperPath);
    command = [
      shellQuote(cliPath),
      '--settings',
      shellQuote(settingsPath),
      '--permission-mode',
      'plan',
      '"$@"',
    ].join(' ');
    environmentOverride = 'ROVER_CLAUDE_PATH';
  } else {
    const codexHome = path.join(run.rootDir, 'codex-home');
    await prepareCodexHome(codexHome, cliPath, run.workspaceDir);
    installCodexHooks(path.join(codexHome, 'hooks.json'), hookHelperPath);
    environment.push(exportLine('CODEX_HOME', codexHome));
    command = [
      shellQuote(cliPath),
      '--dangerously-bypass-hook-trust',
      '--ask-for-approval',
      'never',
      '--sandbox',
      'read-only',
      '"$@"',
    ].join(' ');
    environmentOverride = 'ROVER_CODEX_PATH';
  }

  const wrapper = [
    '#!/bin/sh',
    'set -eu',
    ...environment,
    `case " $* " in`,
    `  *" --resume "*|*" resume "*) printf '%s\\n' "$$" > ${shellQuote(resumePidPath)} ;;`,
    `  *) printf '%s\\n' "$$" > ${shellQuote(launchPidPath)} ;;`,
    'esac',
    `exec ${command}`,
    '',
  ].join('\n');

  fs.writeFileSync(wrapperPath, wrapper, { encoding: 'utf8', mode: 0o700 });

  return {
    agentType: run.agentType,
    cliPath,
    wrapperPath,
    resumePidPath,
    launchPidPath,
    environmentOverride,
  };
}
