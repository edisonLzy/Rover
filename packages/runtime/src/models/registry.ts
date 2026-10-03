import fs from 'node:fs';
import type { Model } from '@earendil-works/pi-ai';
import { loadModelsConfig, saveModelsConfig, resolveApiKey, getModelsConfigPath } from './config.js';
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
  private lastMtimeMs = 0;
  private lastCheckMs = 0;
  private readonly CHECK_INTERVAL_MS = 500; // 500ms 探测节流，避免高频调用中反复进行磁盘 stat

  constructor(customConfigPath?: string) {
    this.customConfigPath = customConfigPath;
    this.reload();
  }

  private checkAndReloadIfChanged(): void {
    const now = Date.now();
    // 节流保护：若 500ms 内已检查过且缓存有效，直接跳过 I/O
    if (now - this.lastCheckMs < this.CHECK_INTERVAL_MS && this.cachedConfig) {
      return;
    }
    this.lastCheckMs = now;

    const filePath = this.customConfigPath || getModelsConfigPath();
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs !== this.lastMtimeMs || !this.cachedConfig) {
          this.reload();
        }
      }
    } catch {
      // In case of stat failure, keep existing cache
    }
  }

  public reload(): RoverModelsConfig {
    const config = loadModelsConfig(this.customConfigPath);
    this.cachedConfig = config;
    this.loadedModels.clear();

    const filePath = this.customConfigPath || getModelsConfigPath();
    try {
      if (fs.existsSync(filePath)) {
        this.lastMtimeMs = fs.statSync(filePath).mtimeMs;
      }
    } catch {
      this.lastMtimeMs = Date.now();
    }
    this.lastCheckMs = Date.now();

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
    this.checkAndReloadIfChanged();
    return this.cachedConfig!;
  }

  public saveConfig(config: RoverModelsConfig): void {
    saveModelsConfig(config, this.customConfigPath);
    this.reload();
  }

  public resolveModel(providerId: string, modelId: string): Model<any> | undefined {
    this.checkAndReloadIfChanged();
    return this.loadedModels.get(`${providerId}/${modelId}`);
  }

  public resolveActiveModel(): Model<any> | undefined {
    // 统一进行一次一致性校验，后续直接读取内部更新好的状态，杜绝嵌套重复调用
    this.checkAndReloadIfChanged();
    const config = this.cachedConfig;
    if (!config?.active) {
      // Fallback: pick the first available model from the first provider
      const firstProviderEntry = Object.entries(config?.providers || {})[0];
      if (firstProviderEntry && firstProviderEntry[1].models?.[0]) {
        return this.loadedModels.get(`${firstProviderEntry[0]}/${firstProviderEntry[1].models[0].id}`);
      }
      return undefined;
    }
    return this.loadedModels.get(`${config.active.provider}/${config.active.model}`);
  }

  public resolveApiKey(providerId: string): string | undefined {
    // 统一进行一次一致性校验，直接读取内部状态
    this.checkAndReloadIfChanged();
    const config = this.cachedConfig;
    const provider = config?.providers?.[providerId];
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
