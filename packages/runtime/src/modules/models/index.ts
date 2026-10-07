export { ModelService, getDefaultModelService } from './service.js';

export { modelsRouter } from './router.js';

export { ModelRegistry, getModelRegistry } from './registry.js';

export {
  loadModelsConfig,
  saveModelsConfig,
  maskModelsConfig,
  setActiveModel,
  saveProvider,
  deleteProvider,
  addModelToProvider,
  deleteModelFromProvider,
  getModelsConfigPath,
  getDefaultModelsConfig,
  ProviderConfigSchema,
  ModelConfigSchema,
  RoverModelsConfigSchema,
} from './schema.js';

export { testModelConnection } from './tester.js';

export { isPiConfigAvailable, getPiModelsConfigPath, importFromPi } from './importer.js';

export type {
  RoverModelsConfig,
  ProviderConfig,
  ModelConfig,
  ActiveModelConfig,
  ModelCost,
  MaskedProviderConfig,
  MaskedRoverModelsConfig,
  ModelConnectionTestResult,
} from './types.js';
