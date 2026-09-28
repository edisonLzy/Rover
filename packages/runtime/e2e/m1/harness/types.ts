import type { AgentType, DispatchAttempt } from '../../../src/index.js';

export type RealAgentType = Extract<AgentType, 'claude' | 'codex'>;

export interface M1E2ERun {
  runId: string;
  agentType: RealAgentType;
  rootDir: string;
  spoolDir: string;
  artifactsDir: string;
  helperPath: string;
  workspaceDir: string;
}

export interface AgentFixture {
  agentType: RealAgentType;
  cliPath: string;
  wrapperPath: string;
  resumePidPath: string;
  launchPidPath: string;
  environmentOverride: 'ROVER_CLAUDE_PATH' | 'ROVER_CODEX_PATH';
}

export interface LauncherPayload {
  attempt: DispatchAttempt;
  options: {
    agentType: RealAgentType;
    cwd: string;
    cliPath: string;
  };
}
