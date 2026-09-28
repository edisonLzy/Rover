import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RealAgentType, M1E2ERun } from './types.js';

export function createM1E2ERun(agentType: RealAgentType): M1E2ERun {
  const runId = `${agentType}_${Date.now()}_${process.pid}`;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `rover-m1-e2e-${runId}-`));
  const spoolDir = path.join(rootDir, 'spool');
  const repositoryRoot = path.resolve(process.cwd(), '../..');
  const artifactsDir = path.join(repositoryRoot, 'test-results', 'm1-e2e', runId);
  const helperPath = path.resolve(process.cwd(), '../app/src-tauri/target/debug/rover-hook-helper');

  fs.mkdirSync(spoolDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });

  return {
    runId,
    agentType,
    rootDir,
    spoolDir,
    artifactsDir,
    helperPath,
    workspaceDir: repositoryRoot,
  };
}

export function removeM1E2ERun(run: M1E2ERun): void {
  fs.rmSync(run.rootDir, { recursive: true, force: true });
}
