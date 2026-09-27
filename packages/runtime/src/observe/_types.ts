/**
 * Observer Hook Configuration Types and Contracts.
 *
 * Mirrors the modular architectural structure of packages/runtime/src/dispatch/types.ts.
 * Only contains type definitions and interfaces.
 */

import type { AgentType } from '../dispatch/types.js';

export type ClaudeHookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'Stop'
  | 'StopFailure';

export type CodexHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop';

export interface SingleHookCommand {
  type: string;
  command: string;
  timeout?: number;
  async?: boolean;
  managedBy?: string;
}

export interface HookGroup {
  matcher?: string;
  hooks: SingleHookCommand[];
}

export interface HookConfigFile {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export interface OpenCodeConfigFile {
  plugin?: string[];
  [key: string]: unknown;
}

export interface HookHealthStatus {
  installed: boolean;
  healthy: boolean;
  eventsCount: number;
  expectedEventsCount: number;
  missingEvents: string[];
}

export interface OverallHookHealth {
  helperBinary: {
    exists: boolean;
    path: string;
  };
  claude: HookHealthStatus;
  codex: HookHealthStatus;
  opencode: HookHealthStatus;
}

export interface HookInstallOptions {
  configPath?: string;
  helperPath?: string;
  pluginPath?: string;
}

export interface HookUninstallOptions {
  configPath?: string;
  pluginIdentifier?: string;
}

export interface HookHealthOptions {
  configPath?: string;
  helperPath?: string;
}

export interface DefaultPaths {
  claudeSettings: string;
  codexHooks: string;
  opencodeConfig: string;
  helperBinary: string;
}

/**
 * Common interface for all agent-specific hook adapters.
 * Symmetrical to AgentAdapter in packages/runtime/src/dispatch/types.ts.
 */
export interface AgentHookAdapter {
  readonly agentType: AgentType;
  getDefaultConfigPath(): string;
  install(options?: HookInstallOptions): void;
  uninstall(options?: HookUninstallOptions): void;
  checkHealth(options?: HookHealthOptions): HookHealthStatus;
}
