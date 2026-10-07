export {
  validateAttemptId,
  getSessionName,
  parseScreenListOutput,
  getScreenSessionInfo,
  listRoverScreenSessions,
  startScreenSession,
  killScreenSession,
  wipeDeadScreenSessions,
  type ScreenSessionStatus,
  type ScreenSessionInfo,
  type StartScreenOptions,
} from './screen.js';

export {
  resolveTerminalAction,
  executeTerminalAction,
  formatActionShellCommand,
  generateTerminalAppleScript,
  resolveDefaultTerminalApp,
  escapeShellArg,
  escapeAppleScriptString,
  type TerminalActionType,
  type TerminalAction,
  type ResolveTerminalActionOptions,
  type TerminalApp,
  type TerminalExecutionResult,
} from './terminal.js';

export {
  getSessionCarrier,
  defaultSessionCarrier,
  ScreenSessionCarrier,
  WindowsSessionCarrier,
  type SessionCarrier,
  type SessionCarrierType,
  type CarrierSessionStatus,
  type CarrierSessionInfo,
  type StartCarrierSessionOptions,
} from './carrier.js';

export {
  AgentRegistry,
  defaultAgentRegistry,
  createDispatchAttempt,
  launchDispatch,
  confirmNativeSession,
  failDispatch,
} from './dispatcher.js';

export type {
  AgentType,
  DispatchOptions,
  DispatchAttempt,
  SessionRefCandidate,
  AgentAdapter,
  AgentAdapterContext,
  LaunchSpec,
  SessionIdStrategy,
} from './types.js';

export { ClaudeAdapter } from './adapters/claude.js';
export { CodexAdapter } from './adapters/codex.js';
export { OpenCodeAdapter } from './adapters/opencode.js';
