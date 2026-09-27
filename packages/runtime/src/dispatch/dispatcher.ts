/**
 * Dispatcher and Session Binding Lifecycle Manager.
 *
 * Implements the core domain invariants from Rover MVP TRD Section 5:
 * 1. Creates un-reusable DispatchAttempt with attemptId, reservedTaskUuid, and capability token.
 * 2. Preallocates session ID for supported agents (Claude, OpenCode) or marks as deferred (Codex).
 * 3. Launches the CLI process inside a SessionCarrier (e.g. GNU Screen).
 * 4. Only establishes SessionRefCandidate upon authoritative native session confirmation.
 * 5. Strictly prevents empty or mismatched Task bindings.
 */

import crypto from 'node:crypto';
import type {
  AgentAdapter,
  AgentAdapterContext,
  AgentType,
  DispatchAttempt,
  DispatchOptions,
  SessionRefCandidate,
} from './types.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { OpenCodeAdapter } from './opencode.js';
import type { CarrierSessionInfo, SessionCarrier } from './carrier.js';

export class AgentRegistry {
  private readonly adapters = new Map<AgentType, AgentAdapter>();

  constructor() {
    this.register(new ClaudeAdapter());
    this.register(new CodexAdapter());
    this.register(new OpenCodeAdapter());
  }

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.agentType, adapter);
  }

  get(agentType: AgentType): AgentAdapter {
    const adapter = this.adapters.get(agentType);
    if (!adapter) {
      throw new Error(`Unsupported agent type: ${agentType}`);
    }
    return adapter;
  }

  has(agentType: AgentType): boolean {
    return this.adapters.has(agentType);
  }

  listRegisteredAgents(): AgentType[] {
    return Array.from(this.adapters.keys());
  }
}

export const defaultAgentRegistry = new AgentRegistry();

/**
 * Creates a new DispatchAttempt enforcing capability token generation and session ID strategy.
 */
export function createDispatchAttempt(
  options: DispatchOptions,
  registry: AgentRegistry = defaultAgentRegistry
): DispatchAttempt {
  const adapter = registry.get(options.agentType);
  const strategy = adapter.defaultSessionIdStrategy;

  const attemptId = `att_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const reservedTaskUuid = crypto.randomUUID();
  const reportToken = crypto.randomBytes(24).toString('hex');

  let preallocatedSessionId: string | undefined;
  if (strategy === 'preallocated') {
    preallocatedSessionId = options.preallocatedSessionId || crypto.randomUUID();
  }

  return {
    attemptId,
    reservedTaskUuid,
    reportToken,
    agentType: options.agentType,
    cwd: options.cwd,
    sessionIdStrategy: strategy,
    preallocatedSessionId,
    status: 'pending',
    createdAt: Date.now(),
  };
}

/**
 * Launches the agent CLI using the specified SessionCarrier.
 */
export async function launchDispatch(
  attempt: DispatchAttempt,
  options: DispatchOptions,
  carrier: SessionCarrier,
  registry: AgentRegistry = defaultAgentRegistry
): Promise<{ attempt: DispatchAttempt; carrierSession: CarrierSessionInfo }> {
  if (attempt.status !== 'pending') {
    throw new Error(`Cannot launch attempt in '${attempt.status}' state`);
  }

  const adapter = registry.get(attempt.agentType);

  const context: AgentAdapterContext = {
    attemptId: attempt.attemptId,
    reportToken: attempt.reportToken,
    reservedTaskUuid: attempt.reservedTaskUuid,
    preallocatedSessionId: attempt.preallocatedSessionId,
  };

  try {
    const launchSpec = await adapter.buildLaunchSpec(options, context);

    const carrierSession = await carrier.startSession({
      attemptId: attempt.attemptId,
      command: launchSpec.command,
      args: launchSpec.args,
      cwd: launchSpec.cwd,
      env: launchSpec.env,
      reportToken: attempt.reportToken,
    });

    attempt.status = 'launched';
    attempt.carrierSessionName = carrierSession.sessionName;

    return {
      attempt,
      carrierSession,
    };
  } catch (error) {
    attempt.status = 'failed';
    attempt.errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/**
 * Confirms an authoritative native session ID, verifying invariants before Task conversion.
 */
export function confirmNativeSession(
  attempt: DispatchAttempt,
  nativeSessionId: string
): SessionRefCandidate {
  if (attempt.status !== 'launched') {
    throw new Error(
      `Cannot confirm native session for attempt in '${attempt.status}' state (must be 'launched')`
    );
  }

  const trimmedId = nativeSessionId.trim();
  if (!trimmedId) {
    throw new Error('Native session ID cannot be empty');
  }

  if (
    attempt.sessionIdStrategy === 'preallocated' &&
    attempt.preallocatedSessionId &&
    attempt.preallocatedSessionId !== trimmedId
  ) {
    throw new Error(
      `Preallocated session mismatch: expected '${attempt.preallocatedSessionId}', received '${trimmedId}'`
    );
  }

  attempt.status = 'confirmed';
  attempt.nativeSessionId = trimmedId;

  return {
    attemptId: attempt.attemptId,
    reservedTaskUuid: attempt.reservedTaskUuid,
    agentType: attempt.agentType,
    nativeSessionId: trimmedId,
    cwd: attempt.cwd,
    confirmedAt: Date.now(),
  };
}

/**
 * Marks a dispatch attempt as failed with diagnostic reason without producing an orphaned Task.
 */
export function failDispatch(attempt: DispatchAttempt, reason: string): DispatchAttempt {
  attempt.status = 'failed';
  attempt.errorMessage = reason;
  return attempt;
}
