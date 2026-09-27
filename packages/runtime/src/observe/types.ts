/**
 * Observer Hook Configuration Types and Contracts.
 *
 * Mirrors the modular architectural structure of packages/runtime/src/dispatch/types.ts.
 */

import os from 'node:os';
import path from 'node:path';
import type { AgentType } from '../dispatch/types.js';

export const ROVER_HOOK_MARKER = 'rover-hook-helper';

export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'StopFailure',
] as const;

export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const;

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

/**
 * Resolves standard default paths for configuration files and hook helper binary.
 */
export function getDefaultPaths() {
  const home = os.homedir();
  return {
    claudeSettings: path.join(home, '.claude', 'settings.json'),
    codexHooks: path.join(home, '.codex', 'hooks.json'),
    opencodeConfig: path.join(home, '.config', 'opencode', 'opencode.json'),
    helperBinary:
      process.env.ROVER_HOOK_HELPER_PATH ||
      path.join(home, 'Library', 'Application Support', 'Rover', 'bin', 'rover-hook-helper'),
  };
}
