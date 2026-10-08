/**
 * Unified Hook Manager & Coordination Facade.
 *
 * Symmetrical to AgentRegistry & Dispatcher in packages/runtime/src/dispatch/dispatcher.ts.
 */

import fs from 'node:fs';
import type { AgentType } from '../dispatch/types.js';
import { getDefaultPaths } from './utils.js';
import type {
  AgentHookAdapter,
  HookHealthOptions,
  HookHealthStatus,
  HookInstallOptions,
  HookUninstallOptions,
  OverallHookHealth,
} from './types.js';
import { ClaudeHookAdapter } from './adapters/claude.js';
import { CodexHookAdapter } from './adapters/codex.js';
import { OpenCodeHookAdapter } from './adapters/opencode.js';

export class HookManager {
  private readonly adapters = new Map<AgentType, AgentHookAdapter>();

  constructor() {
    this.register(new ClaudeHookAdapter());
    this.register(new CodexHookAdapter());
    this.register(new OpenCodeHookAdapter());
  }

  register(adapter: AgentHookAdapter): void {
    this.adapters.set(adapter.agentType, adapter);
  }

  get(agentType: AgentType): AgentHookAdapter {
    const adapter = this.adapters.get(agentType);
    if (!adapter) {
      throw new Error(`Unsupported hook adapter agent type: ${agentType}`);
    }
    return adapter;
  }

  has(agentType: AgentType): boolean {
    return this.adapters.has(agentType);
  }

  listRegisteredAgents(): AgentType[] {
    return Array.from(this.adapters.keys());
  }

  install(agentType: AgentType, options?: HookInstallOptions): void {
    this.get(agentType).install(options);
  }

  uninstall(agentType: AgentType, options?: HookUninstallOptions): void {
    this.get(agentType).uninstall(options);
  }

  checkHealth(agentType: AgentType, options?: HookHealthOptions): HookHealthStatus {
    return this.get(agentType).checkHealth(options);
  }

  installAll(options?: {
    claudePath?: string;
    codexPath?: string;
    opencodePath?: string;
    helperPath?: string;
  }): void {
    this.install('claude', {
      configPath: options?.claudePath,
      helperPath: options?.helperPath,
    });
    this.install('codex', {
      configPath: options?.codexPath,
      helperPath: options?.helperPath,
    });
    this.install('opencode', {
      configPath: options?.opencodePath,
    });
  }

  uninstallAll(options?: { claudePath?: string; codexPath?: string; opencodePath?: string }): void {
    this.uninstall('claude', { configPath: options?.claudePath });
    this.uninstall('codex', { configPath: options?.codexPath });
    this.uninstall('opencode', { configPath: options?.opencodePath });
  }

  checkAllHealth(options?: {
    claudePath?: string;
    codexPath?: string;
    opencodePath?: string;
    helperPath?: string;
  }): OverallHookHealth {
    const helperPath = options?.helperPath || getDefaultPaths().helperBinary;
    const helperExists = fs.existsSync(helperPath);

    const claudeHealth = this.checkHealth('claude', {
      configPath: options?.claudePath,
      helperPath: options?.helperPath,
    });
    const codexHealth = this.checkHealth('codex', {
      configPath: options?.codexPath,
      helperPath: options?.helperPath,
    });
    const opencodeHealth = this.checkHealth('opencode', {
      configPath: options?.opencodePath,
    });

    return {
      helperBinary: {
        exists: helperExists,
        path: helperPath,
      },
      claude: claudeHealth,
      codex: codexHealth,
      opencode: opencodeHealth,
    };
  }
}

export const defaultHookManager = new HookManager();

// ---------------------------------------------------------------------------
// Convenience Functions (Backward Compatible Facade)
// ---------------------------------------------------------------------------

export function installClaudeHooks(customSettingsPath?: string, customHelperPath?: string): void {
  defaultHookManager.install('claude', {
    configPath: customSettingsPath,
    helperPath: customHelperPath,
  });
}

export function uninstallClaudeHooks(customSettingsPath?: string): void {
  defaultHookManager.uninstall('claude', { configPath: customSettingsPath });
}

export function installCodexHooks(customHooksPath?: string, customHelperPath?: string): void {
  defaultHookManager.install('codex', {
    configPath: customHooksPath,
    helperPath: customHelperPath,
  });
}

export function uninstallCodexHooks(customHooksPath?: string): void {
  defaultHookManager.uninstall('codex', { configPath: customHooksPath });
}

export function installOpenCodePlugin(customConfigPath?: string, pluginPath?: string): void {
  defaultHookManager.install('opencode', {
    configPath: customConfigPath,
    pluginPath,
  });
}

export function uninstallOpenCodePlugin(
  customConfigPath?: string,
  pluginIdentifier?: string
): void {
  defaultHookManager.uninstall('opencode', {
    configPath: customConfigPath,
    pluginIdentifier,
  });
}

export function checkHooksHealth(options?: {
  claudePath?: string;
  codexPath?: string;
  opencodePath?: string;
  helperPath?: string;
}): OverallHookHealth {
  return defaultHookManager.checkAllHealth(options);
}

export function installAllHooks(options?: {
  claudePath?: string;
  codexPath?: string;
  opencodePath?: string;
  helperPath?: string;
}): void {
  defaultHookManager.installAll(options);
}

export function uninstallAllHooks(options?: {
  claudePath?: string;
  codexPath?: string;
  opencodePath?: string;
}): void {
  defaultHookManager.uninstallAll(options);
}
