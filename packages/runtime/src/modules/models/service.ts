import {
  loadModelsConfig,
  maskModelsConfig,
  setActiveModel,
  saveProvider,
  deleteProvider,
  addModelToProvider,
  deleteModelFromProvider,
} from './schema.js';
import { testModelConnection } from './tester.js';
import { isPiConfigAvailable, getPiModelsConfigPath, importFromPi } from './importer.js';
import { ModelRegistry, getModelRegistry } from './registry.js';
import type {
  RoverModelsConfig,
  MaskedRoverModelsConfig,
  ProviderConfig,
  ModelConfig,
  ModelConnectionTestResult,
} from './types.js';

export class ModelService {
  private registry: ModelRegistry;

  constructor(registry: ModelRegistry = getModelRegistry()) {
    this.registry = registry;
  }

  getRegistry(): ModelRegistry {
    return this.registry;
  }

  getConfig(): RoverModelsConfig {
    return loadModelsConfig();
  }

  getMaskedConfig(): MaskedRoverModelsConfig {
    const config = this.getConfig();
    return maskModelsConfig(config);
  }

  getActiveModel() {
    const active = this.registry.resolveActiveModel();
    return {
      hasActiveModel: !!active,
      activeModel: active
        ? {
            id: active.id,
            name: active.name,
            provider: active.provider,
          }
        : null,
    };
  }

  setActive(input: { provider: string; model: string }): MaskedRoverModelsConfig {
    const updated = setActiveModel(input);
    return maskModelsConfig(updated);
  }

  saveProvider(id: string, provider: ProviderConfig): MaskedRoverModelsConfig {
    const updated = saveProvider(id, provider);
    return maskModelsConfig(updated);
  }

  deleteProvider(id: string): MaskedRoverModelsConfig {
    const updated = deleteProvider(id);
    return maskModelsConfig(updated);
  }

  addModel(providerId: string, model: ModelConfig): MaskedRoverModelsConfig {
    const updated = addModelToProvider(providerId, model);
    return maskModelsConfig(updated);
  }

  deleteModel(providerId: string, modelId: string): MaskedRoverModelsConfig {
    const updated = deleteModelFromProvider(providerId, modelId);
    return maskModelsConfig(updated);
  }

  async testConnection(input: {
    provider: string;
    model: string;
  }): Promise<ModelConnectionTestResult> {
    return testModelConnection(input);
  }

  checkPiAvailability(): { available: boolean; path: string } {
    return {
      available: isPiConfigAvailable(),
      path: getPiModelsConfigPath(),
    };
  }

  importFromPi(options?: { overwrite?: boolean }): {
    importedProviders: string[];
    totalModels: number;
    config: MaskedRoverModelsConfig;
  } {
    const result = importFromPi({ overwrite: options?.overwrite });
    const config = this.getConfig();
    return {
      ...result,
      config: maskModelsConfig(config),
    };
  }
}
