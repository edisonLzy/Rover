/**
 * OpenCode Hook / Plugin Adapter.
 *
 * Implements AgentHookAdapter for OpenCode (~/.config/opencode/opencode.json).
 */

import type { AgentType } from '../../dispatch/types.js';
import { getDefaultPaths, safeReadJson, safeWriteJsonWithBackup } from '../utils.js';
import type {
  AgentHookAdapter,
  HookHealthOptions,
  HookHealthStatus,
  HookInstallOptions,
  HookUninstallOptions,
  OpenCodeConfigFile,
} from '../types.js';

export class OpenCodeHookAdapter implements AgentHookAdapter {
  readonly agentType: AgentType = 'opencode';

  getDefaultConfigPath(): string {
    return getDefaultPaths().opencodeConfig;
  }

  install(options?: HookInstallOptions): void {
    const configPath = options?.configPath || this.getDefaultConfigPath();
    const pluginPath = options?.pluginPath || '/Users/zhiyu/.opencode/plugins/rover';

    const config: OpenCodeConfigFile = safeReadJson<OpenCodeConfigFile>(configPath) || {};
    if (!config.plugin) {
      config.plugin = [];
    }

    if (!config.plugin.includes(pluginPath)) {
      config.plugin.push(pluginPath);
      safeWriteJsonWithBackup(configPath, config);
    }
  }

  uninstall(options?: HookUninstallOptions): void {
    const configPath = options?.configPath || this.getDefaultConfigPath();
    const pluginIdentifier = options?.pluginIdentifier || 'rover';

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

  checkHealth(options?: HookHealthOptions): HookHealthStatus {
    const configPath = options?.configPath || this.getDefaultConfigPath();
    const config = safeReadJson<OpenCodeConfigFile>(configPath);
    const isInstalled = Boolean(config?.plugin?.some((p) => p.includes('rover')));

    return {
      installed: isInstalled,
      healthy: isInstalled,
      eventsCount: isInstalled ? 1 : 0,
      expectedEventsCount: 1,
      missingEvents: isInstalled ? [] : ['opencode-rover-plugin'],
    };
  }
}
