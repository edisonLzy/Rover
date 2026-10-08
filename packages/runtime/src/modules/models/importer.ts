import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoverModelsConfigSchema } from './types.js';
import { loadModelsConfig, saveModelsConfig } from './config.js';

export function getPiModelsConfigPath(): string {
  return path.join(os.homedir(), '.pi', 'agent', 'models.json');
}

export function isPiConfigAvailable(customPiPath?: string): boolean {
  const filePath = customPiPath || getPiModelsConfigPath();
  return fs.existsSync(filePath);
}

export interface ImportFromPiOptions {
  overwrite?: boolean;
  roverConfigPath?: string;
  piConfigPath?: string;
}

export interface ImportResult {
  importedProviders: string[];
  totalModels: number;
}

/**
 * Non-destructively imports providers and models from ~/.pi/agent/models.json into Rover.
 */
export function importFromPi(options: ImportFromPiOptions = {}): ImportResult {
  const piPath = options.piConfigPath || getPiModelsConfigPath();

  if (!fs.existsSync(piPath)) {
    throw new Error(`Pi models.json not found at ${piPath}`);
  }

  const raw = fs.readFileSync(piPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse Pi models.json as JSON: ${String(err)}`);
  }

  const piResult = RoverModelsConfigSchema.safeParse(parsed);
  if (!piResult.success) {
    throw new Error(`Pi models.json format is incompatible: ${piResult.error.message}`);
  }

  const piConfig = piResult.data;
  const roverConfig = loadModelsConfig(options.roverConfigPath);

  const importedProviders: string[] = [];
  let totalModels = 0;

  for (const [providerId, piProvider] of Object.entries(piConfig.providers || {})) {
    const exists = Boolean(roverConfig.providers[providerId]);
    if (!exists || options.overwrite) {
      roverConfig.providers[providerId] = piProvider;
      importedProviders.push(providerId);
      totalModels += piProvider.models?.length || 0;
    }
  }

  // If Rover had no active model, set first imported model as active
  if (!roverConfig.active && importedProviders.length > 0) {
    const firstProviderId = importedProviders[0];
    const firstProvider = roverConfig.providers[firstProviderId];
    if (firstProvider.models && firstProvider.models.length > 0) {
      roverConfig.active = {
        provider: firstProviderId,
        model: firstProvider.models[0].id,
      };
    }
  }

  saveModelsConfig(roverConfig, options.roverConfigPath);

  return {
    importedProviders,
    totalModels,
  };
}
