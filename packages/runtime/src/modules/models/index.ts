/**
 * Models Module Facade (ADR-0020 & AGENTS.md)
 * 严格对外导出该模块公开的 Service、Router、Registry 和契约类型。
 */

export { ModelService, type ModelServiceOptions } from './service.js';
export { modelsRouter } from './router.js';
export { ModelRegistry } from './registry.js';

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
