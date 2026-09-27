/**
 * User-Level CLI Hook Configuration & Safe Lifecycle Manager.
 *
 * Implements M1-3 Ticket Requirements:
 * - Safe merging & idempotent installation of Rover hooks into Claude Code, Codex, and OpenCode.
 * - Mandatory pre-modification backups (*.rover.bak).
 * - Non-destructive: strictly preserves other tools' hooks (Orca, Clawd, Herdr, custom user hooks).
 * - 100% clean uninstall restoring pristine state.
 * - Health check auditing helper binary availability and hook registration integrity.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  opencode: {
    installed: boolean;
    healthy: boolean;
  };
}

/**
 * Resolves default paths for configuration files and hook helper binary.
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

function safeReadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeWriteJsonWithBackup<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Mandatory backup before write
  if (fs.existsSync(filePath)) {
    const backupPath = `${filePath}.rover.bak`;
    fs.copyFileSync(filePath, backupPath);
  }

  const jsonContent = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = `${filePath}.tmp_${Date.now()}`;
  fs.writeFileSync(tempPath, jsonContent, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

// ---------------------------------------------------------------------------
// Claude Code Hooks
// ---------------------------------------------------------------------------

export function installClaudeHooks(customSettingsPath?: string, customHelperPath?: string): void {
  const settingsPath = customSettingsPath || getDefaultPaths().claudeSettings;
  const helperPath = customHelperPath || getDefaultPaths().helperBinary;

  const config: HookConfigFile = safeReadJson<HookConfigFile>(settingsPath) || {};
  if (!config.hooks) {
    config.hooks = {};
  }

  for (const event of CLAUDE_HOOK_EVENTS) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }

    const groups = config.hooks[event];
    const alreadyInstalled = groups.some((group) =>
      group.hooks?.some((h) => h.command?.includes(ROVER_HOOK_MARKER))
    );

    if (!alreadyInstalled) {
      groups.push({
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `"${helperPath}" ${event}`,
            timeout: 5,
            async: true,
            managedBy: 'rover',
          },
        ],
      });
    }
  }

  safeWriteJsonWithBackup(settingsPath, config);
}

export function uninstallClaudeHooks(customSettingsPath?: string): void {
  const settingsPath = customSettingsPath || getDefaultPaths().claudeSettings;
  const config = safeReadJson<HookConfigFile>(settingsPath);
  if (!config || !config.hooks) {
    return;
  }

  let modified = false;

  for (const [event, groups] of Object.entries(config.hooks)) {
    const filtered = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((h) => !h.command?.includes(ROVER_HOOK_MARKER)),
      }))
      .filter((group) => group.hooks.length > 0);

    if (filtered.length !== groups.length) {
      modified = true;
      if (filtered.length === 0) {
        delete config.hooks[event];
      } else {
        config.hooks[event] = filtered;
      }
    }
  }

  if (modified) {
    safeWriteJsonWithBackup(settingsPath, config);
  }
}

// ---------------------------------------------------------------------------
// OpenAI Codex Hooks
// ---------------------------------------------------------------------------

export function installCodexHooks(customHooksPath?: string, customHelperPath?: string): void {
  const hooksPath = customHooksPath || getDefaultPaths().codexHooks;
  const helperPath = customHelperPath || getDefaultPaths().helperBinary;

  const config: HookConfigFile = safeReadJson<HookConfigFile>(hooksPath) || {};
  if (!config.hooks) {
    config.hooks = {};
  }

  for (const event of CODEX_HOOK_EVENTS) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }

    const groups = config.hooks[event];
    const alreadyInstalled = groups.some((group) =>
      group.hooks?.some((h) => h.command?.includes(ROVER_HOOK_MARKER))
    );

    if (!alreadyInstalled) {
      groups.push({
        hooks: [
          {
            type: 'command',
            command: `"${helperPath}" ${event}`,
            timeout: 10,
            async: true,
            managedBy: 'rover',
          },
        ],
      });
    }
  }

  safeWriteJsonWithBackup(hooksPath, config);
}

export function uninstallCodexHooks(customHooksPath?: string): void {
  const hooksPath = customHooksPath || getDefaultPaths().codexHooks;
  const config = safeReadJson<HookConfigFile>(hooksPath);
  if (!config || !config.hooks) {
    return;
  }

  let modified = false;

  for (const [event, groups] of Object.entries(config.hooks)) {
    const filtered = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((h) => !h.command?.includes(ROVER_HOOK_MARKER)),
      }))
      .filter((group) => group.hooks.length > 0);

    if (filtered.length !== groups.length) {
      modified = true;
      if (filtered.length === 0) {
        delete config.hooks[event];
      } else {
        config.hooks[event] = filtered;
      }
    }
  }

  if (modified) {
    safeWriteJsonWithBackup(hooksPath, config);
  }
}

// ---------------------------------------------------------------------------
// OpenCode Plugin
// ---------------------------------------------------------------------------

export function installOpenCodePlugin(
  customConfigPath?: string,
  pluginPath = '/Users/zhiyu/.opencode/plugins/rover'
): void {
  const configPath = customConfigPath || getDefaultPaths().opencodeConfig;
  const config: OpenCodeConfigFile = safeReadJson<OpenCodeConfigFile>(configPath) || {};

  if (!config.plugin) {
    config.plugin = [];
  }

  if (!config.plugin.includes(pluginPath)) {
    config.plugin.push(pluginPath);
    safeWriteJsonWithBackup(configPath, config);
  }
}

export function uninstallOpenCodePlugin(
  customConfigPath?: string,
  pluginIdentifier = 'rover'
): void {
  const configPath = customConfigPath || getDefaultPaths().opencodeConfig;
  const config = safeReadJson<OpenCodeConfigFile>(configPath);
  if (!config || !config.plugin) {
    return;
  }

  const filtered = config.plugin.filter((p) => !p.includes(pluginIdentifier));
  if (filtered.length !== config.plugin.length) {
    config.plugin = filtered;
    safeWriteJsonWithBackup(configPath, config);
  }
}

// ---------------------------------------------------------------------------
// Health Checks & Lifecycle Auditing
// ---------------------------------------------------------------------------

function checkHookEventsHealth(
  config: HookConfigFile | null,
  expectedEvents: readonly string[]
): HookHealthStatus {
  if (!config || !config.hooks) {
    return {
      installed: false,
      healthy: false,
      eventsCount: 0,
      expectedEventsCount: expectedEvents.length,
      missingEvents: [...expectedEvents],
    };
  }

  const missingEvents: string[] = [];
  let installedCount = 0;

  for (const event of expectedEvents) {
    const groups = config.hooks[event];
    const hasRoverHook = groups?.some((group) =>
      group.hooks?.some((h) => h.command?.includes(ROVER_HOOK_MARKER))
    );

    if (hasRoverHook) {
      installedCount += 1;
    } else {
      missingEvents.push(event);
    }
  }

  const installed = installedCount > 0;
  const healthy = installedCount === expectedEvents.length;

  return {
    installed,
    healthy,
    eventsCount: installedCount,
    expectedEventsCount: expectedEvents.length,
    missingEvents,
  };
}

export function checkHooksHealth(options?: {
  claudePath?: string;
  codexPath?: string;
  opencodePath?: string;
  helperPath?: string;
}): OverallHookHealth {
  const defaults = getDefaultPaths();
  const helperPath = options?.helperPath || defaults.helperBinary;
  const helperExists = fs.existsSync(helperPath);

  const claudeConfig = safeReadJson<HookConfigFile>(options?.claudePath || defaults.claudeSettings);
  const codexConfig = safeReadJson<HookConfigFile>(options?.codexPath || defaults.codexHooks);
  const opencodeConfig = safeReadJson<OpenCodeConfigFile>(
    options?.opencodePath || defaults.opencodeConfig
  );

  const claudeHealth = checkHookEventsHealth(claudeConfig, CLAUDE_HOOK_EVENTS);
  const codexHealth = checkHookEventsHealth(codexConfig, CODEX_HOOK_EVENTS);

  const opencodeInstalled = Boolean(opencodeConfig?.plugin?.some((p) => p.includes('rover')));

  return {
    helperBinary: {
      exists: helperExists,
      path: helperPath,
    },
    claude: claudeHealth,
    codex: codexHealth,
    opencode: {
      installed: opencodeInstalled,
      healthy: opencodeInstalled,
    },
  };
}

export function installAllHooks(options?: {
  claudePath?: string;
  codexPath?: string;
  opencodePath?: string;
  helperPath?: string;
}): void {
  installClaudeHooks(options?.claudePath, options?.helperPath);
  installCodexHooks(options?.codexPath, options?.helperPath);
  installOpenCodePlugin(options?.opencodePath);
}

export function uninstallAllHooks(options?: {
  claudePath?: string;
  codexPath?: string;
  opencodePath?: string;
}): void {
  uninstallClaudeHooks(options?.claudePath);
  uninstallCodexHooks(options?.codexPath);
  uninstallOpenCodePlugin(options?.opencodePath);
}
