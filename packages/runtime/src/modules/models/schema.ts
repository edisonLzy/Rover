import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RoverModelsConfigSchema,
  type ActiveModelConfig,
  type MaskedProviderConfig,
  type MaskedRoverModelsConfig,
  type ModelConfig,
  type ProviderConfig,
  type RoverModelsConfig,
} from './types.js';

export function getModelsConfigPath(): string {
  if (process.env.ROVER_MODELS_PATH) {
    return path.resolve(process.env.ROVER_MODELS_PATH);
  }
  return path.join(os.homedir(), '.rover', 'models.json');
}

export function getDefaultModelsConfig(): RoverModelsConfig {
  return {
    active: {
      provider: 'deepseek',
      model: 'deepseek-chat',
    },
    providers: {
      deepseek: {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '${DEEPSEEK_API_KEY}',
        api: 'openai-completions',
        models: [
          {
            id: 'deepseek-chat',
            name: 'DeepSeek V3',
            reasoning: false,
            input: ['text'],
            contextWindow: 64000,
            maxTokens: 8192,
            cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
          },
          {
            id: 'deepseek-reasoner',
            name: 'DeepSeek R1',
            reasoning: true,
            input: ['text'],
            contextWindow: 64000,
            maxTokens: 8192,
            cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
          },
        ],
      },
    },
  };
}

/**
 * Loads models configuration from file.
 * Treats the filesystem file as the Single Source of Truth (no memory caching).
 * Automatically initializes with default template if not present.
 */
export function loadModelsConfig(customPath?: string): RoverModelsConfig {
  const filePath = customPath || getModelsConfigPath();

  if (!fs.existsSync(filePath)) {
    const defaultConfig = getDefaultModelsConfig();
    saveModelsConfig(defaultConfig, filePath);
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = RoverModelsConfigSchema.parse(parsed);
    return validated;
  } catch (error) {
    console.error(`[Rover Model Config] Failed to load config from ${filePath}:`, error);
    throw new Error(
      `Failed to load models configuration from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Atomically saves models configuration with 0600 permissions.
 */
export function saveModelsConfig(config: RoverModelsConfig, customPath?: string): void {
  const filePath = customPath || getModelsConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const validated = RoverModelsConfigSchema.parse(config);
  const jsonStr = JSON.stringify(validated, null, 2);

  // Atomic write via temp file
  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  fs.writeFileSync(tmpPath, jsonStr, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod errors on systems that don't support posix modes
  }
}

/**
 * Resolves API Key, expanding ${ENV_VAR} placeholder if present.
 */
export function resolveApiKey(apiKeyOrPattern?: string): string {
  if (!apiKeyOrPattern) return '';
  const trimmed = apiKeyOrPattern.trim();
  const envMatch = trimmed.match(/^\$\{([A-Za-z0-9_]+)\}$/);
  if (envMatch) {
    const varName = envMatch[1];
    return process.env[varName] || '';
  }
  return trimmed;
}

/**
 * Masks an API Key for safe frontend inspection.
 */
export function maskApiKey(rawKey?: string): string {
  if (!rawKey) return '';
  const trimmed = rawKey.trim();
  if (trimmed.startsWith('${') && trimmed.endsWith('}')) {
    return trimmed; // Show environment variable name directly (e.g. ${DEEPSEEK_API_KEY})
  }
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

/**
 * Generates masked configuration for transmission to frontend via tRPC.
 */
export function maskModelsConfig(config: RoverModelsConfig): MaskedRoverModelsConfig {
  const maskedProviders: Record<string, MaskedProviderConfig> = {};

  for (const [id, provider] of Object.entries(config.providers || {})) {
    const rawKey = provider.apiKey || '';
    const resolved = resolveApiKey(rawKey);
    const isEnvVar = rawKey.startsWith('${') && rawKey.endsWith('}');

    maskedProviders[id] = {
      ...provider,
      apiKey: maskApiKey(rawKey),
      hasKey: Boolean(resolved.length > 0),
      isEnvVar,
    };
  }

  return {
    ...config,
    providers: maskedProviders,
  };
}

/**
 * Sets the active model in configuration.
 */
export function setActiveModel(active: ActiveModelConfig, customPath?: string): RoverModelsConfig {
  const current = loadModelsConfig(customPath);
  const updated: RoverModelsConfig = {
    ...current,
    active,
  };
  saveModelsConfig(updated, customPath);
  return updated;
}

/**
 * Adds or updates a provider configuration.
 */
export function saveProvider(
  id: string,
  provider: ProviderConfig,
  customPath?: string
): RoverModelsConfig {
  const current = loadModelsConfig(customPath);
  const updated: RoverModelsConfig = {
    ...current,
    providers: {
      ...current.providers,
      [id]: provider,
    },
  };
  saveModelsConfig(updated, customPath);
  return updated;
}

/**
 * Deletes a provider from configuration.
 */
export function deleteProvider(id: string, customPath?: string): RoverModelsConfig {
  const current = loadModelsConfig(customPath);
  const nextProviders = { ...current.providers };
  delete nextProviders[id];

  const updated: RoverModelsConfig = {
    ...current,
    providers: nextProviders,
  };

  // If deleted provider was the active one, clear active
  if (updated.active?.provider === id) {
    delete updated.active;
  }

  saveModelsConfig(updated, customPath);
  return updated;
}

/**
 * Adds or updates a model within a specific provider.
 */
export function addModelToProvider(
  providerId: string,
  model: ModelConfig,
  customPath?: string
): RoverModelsConfig {
  const current = loadModelsConfig(customPath);
  const provider = current.providers[providerId];
  if (!provider) {
    throw new Error(`Provider "${providerId}" not found in models configuration.`);
  }

  const existingModels = provider.models || [];
  const existingIdx = existingModels.findIndex((m) => m.id === model.id);
  const updatedModels = [...existingModels];

  if (existingIdx >= 0) {
    updatedModels[existingIdx] = { ...updatedModels[existingIdx], ...model };
  } else {
    updatedModels.push(model);
  }

  const updated: RoverModelsConfig = {
    ...current,
    providers: {
      ...current.providers,
      [providerId]: {
        ...provider,
        models: updatedModels,
      },
    },
  };

  saveModelsConfig(updated, customPath);
  return updated;
}

/**
 * Deletes a model from a specific provider.
 */
export function deleteModelFromProvider(
  providerId: string,
  modelId: string,
  customPath?: string
): RoverModelsConfig {
  const current = loadModelsConfig(customPath);
  const provider = current.providers[providerId];
  if (!provider) {
    throw new Error(`Provider "${providerId}" not found in models configuration.`);
  }

  const updatedModels = (provider.models || []).filter((m) => m.id !== modelId);
  const updated: RoverModelsConfig = {
    ...current,
    providers: {
      ...current.providers,
      [providerId]: {
        ...provider,
        models: updatedModels,
      },
    },
  };

  // If deleted model was the active one for this provider, clear active
  if (updated.active?.provider === providerId && updated.active?.model === modelId) {
    delete updated.active;
  }

  saveModelsConfig(updated, customPath);
  return updated;
}

export { ProviderConfigSchema, ModelConfigSchema, RoverModelsConfigSchema } from './types.js';
