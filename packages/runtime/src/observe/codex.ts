/**
 * OpenAI Codex Hook Adapter.
 *
 * Implements AgentHookAdapter for Codex (~/.codex/hooks.json).
 */

import type { AgentType } from '../dispatch/types.js';
import { CODEX_HOOK_EVENTS, ROVER_HOOK_MARKER } from './_constant.js';
import { getDefaultPaths, safeReadJson, safeWriteJsonWithBackup } from './_utils.js';
import type {
  AgentHookAdapter,
  HookConfigFile,
  HookHealthOptions,
  HookHealthStatus,
  HookInstallOptions,
  HookUninstallOptions,
} from './_types.js';

export class CodexHookAdapter implements AgentHookAdapter {
  readonly agentType: AgentType = 'codex';

  getDefaultConfigPath(): string {
    return getDefaultPaths().codexHooks;
  }

  install(options?: HookInstallOptions): void {
    const hooksPath = options?.configPath || this.getDefaultConfigPath();
    const helperPath = options?.helperPath || getDefaultPaths().helperBinary;

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

  uninstall(options?: HookUninstallOptions): void {
    const hooksPath = options?.configPath || this.getDefaultConfigPath();
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

  checkHealth(options?: HookHealthOptions): HookHealthStatus {
    const hooksPath = options?.configPath || this.getDefaultConfigPath();
    const config = safeReadJson<HookConfigFile>(hooksPath);

    if (!config || !config.hooks) {
      return {
        installed: false,
        healthy: false,
        eventsCount: 0,
        expectedEventsCount: CODEX_HOOK_EVENTS.length,
        missingEvents: [...CODEX_HOOK_EVENTS],
      };
    }

    const missingEvents: string[] = [];
    let installedCount = 0;

    for (const event of CODEX_HOOK_EVENTS) {
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

    return {
      installed: installedCount > 0,
      healthy: installedCount === CODEX_HOOK_EVENTS.length,
      eventsCount: installedCount,
      expectedEventsCount: CODEX_HOOK_EVENTS.length,
      missingEvents,
    };
  }
}
