/**
 * Agent Dispatch & Session Binding Type Definitions.
 *
 * Implements architectural contracts from:
 * - Rover MVP TRD Section 5 & 10
 * - CONTEXT.md (Agent 派发, Agent Session, Task 确权)
 * - M1-2 Ticket Specification
 */

export type AgentType = 'claude' | 'codex' | 'opencode';

/**
 * Strategy for acquiring native session identity.
 * - 'preallocated': The CLI accepts a caller-specified session ID before starting (e.g., Claude `--session-id <UUID>`, OpenCode `-s <UUID>`).
 * - 'deferred': The CLI generates its own session ID; Rover binds the session upon receiving authoritative event signals (e.g. Codex Hook `SessionStart`).
 */
export type SessionIdStrategy = 'preallocated' | 'deferred';

export interface LaunchSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface DispatchOptions {
  agentType: AgentType;
  cwd: string;
  prompt?: string;
  preallocatedSessionId?: string;
  cliPath?: string;
  extraArgs?: string[];
  extraEnv?: Record<string, string>;
}

export type DispatchAttemptStatus = 'pending' | 'launched' | 'confirmed' | 'failed';

export interface DispatchAttempt {
  attemptId: string;
  reservedTaskUuid: string;
  reportToken: string;
  agentType: AgentType;
  cwd: string;
  sessionIdStrategy: SessionIdStrategy;
  preallocatedSessionId?: string;
  nativeSessionId?: string;
  status: DispatchAttemptStatus;
  createdAt: number;
  carrierSessionName?: string;
  errorMessage?: string;
}

export interface SessionRefCandidate {
  attemptId: string;
  reservedTaskUuid: string;
  agentType: AgentType;
  nativeSessionId: string;
  cwd: string;
  confirmedAt: number;
}

export interface AgentAdapterContext {
  attemptId: string;
  reportToken: string;
  reservedTaskUuid: string;
  preallocatedSessionId?: string;
}

export interface AgentAdapter {
  readonly agentType: AgentType;
  readonly defaultSessionIdStrategy: SessionIdStrategy;
  resolveCliPath(customPath?: string): Promise<string>;
  buildLaunchSpec(options: DispatchOptions, context: AgentAdapterContext): Promise<LaunchSpec>;
  getResumeSpec(nativeSessionId: string, customPath?: string): Promise<LaunchSpec>;
}
