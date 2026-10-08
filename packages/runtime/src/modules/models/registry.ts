import type { Model } from '@earendil-works/pi-ai';
import { loadModelsConfig, saveModelsConfig, resolveApiKey } from './config.js';
import type { ModelConfig, ProviderConfig, RoverModelsConfig } from './types.js';

function toPiAiModel(
  providerName: string,
  providerCfg: ProviderConfig,
  modelCfg: ModelConfig
): Model<any> {
  return {
    id: modelCfg.id,
    api: providerCfg.api as any,
    baseUrl: providerCfg.baseUrl,
    provider: providerName,
    headers: providerCfg.headers,
    name: modelCfg.name ?? modelCfg.id,
    reasoning: modelCfg.reasoning ?? false,
    input: (modelCfg.input as ('text' | 'image')[]) ?? ['text'],
    cost: {
      input: modelCfg.cost?.input ?? 0,
      output: modelCfg.cost?.output ?? 0,
      cacheRead: modelCfg.cost?.cacheRead ?? 0,
      cacheWrite: modelCfg.cost?.cacheWrite ?? 0,
    },
    contextWindow: modelCfg.contextWindow ?? 128000,
    maxTokens: modelCfg.maxTokens ?? 16384,
  };
}

/**
 * Manages model loading and resolution for Rover Runtime.
 * Completely stateless: treats ~/.rover/models.json as the Single Source of Truth (SSOT).
 * Reads directly from disk on every invocation, eliminating in-memory cache invalidation,
 * mtime polling, and multi-window state synchronization issues.
 */
export class ModelRegistry {
  constructor(private customConfigPath?: string) {}

  /**
   * Reloads configuration from disk.
   * Kept for API compatibility; since there is no in-memory cache, simply reads fresh config.
   */
  public reload(): RoverModelsConfig {
    return this.getConfig();
  }

  public getConfig(): RoverModelsConfig {
    return loadModelsConfig(this.customConfigPath);
  }

  public saveConfig(config: RoverModelsConfig): void {
    saveModelsConfig(config, this.customConfigPath);
  }

  public resolveModel(providerId: string, modelId: string): Model<any> | undefined {
    try {
      const config = this.getConfig();
      const provider = config.providers?.[providerId];
      if (!provider || !provider.models) return undefined;
      const modelCfg = provider.models.find((m) => m.id === modelId);
      if (!modelCfg) return undefined;
      return toPiAiModel(providerId, provider, modelCfg);
    } catch {
      return undefined;
    }
  }

  public resolveActiveModel(): Model<any> | undefined {
    try {
      const config = this.getConfig();
      if (!config.active) {
        // Fallback: pick the first available model from the first provider
        const firstProviderEntry = Object.entries(config.providers || {})[0];
        if (firstProviderEntry && firstProviderEntry[1].models?.[0]) {
          return toPiAiModel(
            firstProviderEntry[0],
            firstProviderEntry[1],
            firstProviderEntry[1].models[0]
          );
        }
        return undefined;
      }
      return this.resolveModel(config.active.provider, config.active.model);
    } catch {
      return undefined;
    }
  }

  public resolveApiKey(providerId: string): string | undefined {
    try {
      const config = this.getConfig();
      const provider = config.providers?.[providerId];
      if (!provider) return undefined;
      return resolveApiKey(provider.apiKey);
    } catch {
      return undefined;
    }
  }
}
