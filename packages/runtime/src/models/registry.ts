import type { Model } from '@earendil-works/pi-ai';
import { loadModelsConfig, saveModelsConfig, resolveApiKey } from './config.js';
import type { RoverModelsConfig } from './types.js';

type ModelKey = `${string}/${string}`;

/**
 * Manages model loading, caching, and resolution for Rover Runtime.
 * Follows the divisor-agent ModelRegistry pattern, resolving configurations
 * from ~/.rover/models.json into Pi AI compatible Model<any> descriptors.
 */
export class ModelRegistry {
  private customConfigPath?: string;
  private loadedModels = new Map<ModelKey, Model<any>>();
  private cachedConfig: RoverModelsConfig | null = null;

  constructor(customConfigPath?: string) {
    this.customConfigPath = customConfigPath;
    this.reload();
  }

  public reload(): RoverModelsConfig {
    const config = loadModelsConfig(this.customConfigPath);
    this.cachedConfig = config;
    this.loadedModels.clear();

    if (!config.providers) {
      return config;
    }

    for (const [providerName, providerCfg] of Object.entries(config.providers)) {
      if (!providerCfg.models) continue;

      for (const modelCfg of providerCfg.models) {
        const key: ModelKey = `${providerName}/${modelCfg.id}`;
        const model: Model<any> = {
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
        this.loadedModels.set(key, model);
      }
    }

    return config;
  }

  public getConfig(): RoverModelsConfig {
    if (!this.cachedConfig) {
      return this.reload();
    }
    return this.cachedConfig;
  }

  public saveConfig(config: RoverModelsConfig): void {
    saveModelsConfig(config, this.customConfigPath);
    this.reload();
  }

  public resolveModel(providerId: string, modelId: string): Model<any> | undefined {
    return this.loadedModels.get(`${providerId}/${modelId}`);
  }

  public resolveActiveModel(): Model<any> | undefined {
    const config = this.getConfig();
    if (!config.active) {
      // Fallback: pick the first available model from the first provider
      const firstProviderEntry = Object.entries(config.providers || {})[0];
      if (firstProviderEntry && firstProviderEntry[1].models?.[0]) {
        return this.resolveModel(firstProviderEntry[0], firstProviderEntry[1].models[0].id);
      }
      return undefined;
    }
    return this.resolveModel(config.active.provider, config.active.model);
  }

  public resolveApiKey(providerId: string): string | undefined {
    const config = this.getConfig();
    const provider = config.providers[providerId];
    if (!provider) return undefined;
    return resolveApiKey(provider.apiKey);
  }
}

// Global default singleton
let defaultRegistry: ModelRegistry | null = null;

export function getModelRegistry(customConfigPath?: string): ModelRegistry {
  if (!defaultRegistry || customConfigPath) {
    defaultRegistry = new ModelRegistry(customConfigPath);
  }
  return defaultRegistry;
}
