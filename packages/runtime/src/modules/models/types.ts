import { z } from 'zod';

export const ModelCostSchema = z
  .object({
    input: z.number().default(0),
    output: z.number().default(0),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
  })
  .passthrough();

export const ModelConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    contextWindow: z.number().int().positive().default(128000),
    maxTokens: z.number().int().positive().default(8192),
    reasoning: z.boolean().default(false),
    input: z.array(z.string()).default(['text']),
    cost: ModelCostSchema.default({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
  })
  .passthrough();

export const ProviderConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
    apiKey: z.string().optional().default(''),
    api: z
      .enum(['openai-completions', 'anthropic-messages'])
      .or(z.string())
      .default('openai-completions'),
    authHeader: z.boolean().optional(),
    headers: z.record(z.string()).optional(),
    models: z.array(ModelConfigSchema).default([]),
  })
  .passthrough();

export const ActiveModelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

export const RoverModelsConfigSchema = z
  .object({
    active: ActiveModelConfigSchema.optional(),
    providers: z.record(ProviderConfigSchema).default({}),
  })
  .passthrough();

export type ModelCost = z.infer<typeof ModelCostSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ActiveModelConfig = z.infer<typeof ActiveModelConfigSchema>;
export type RoverModelsConfig = z.infer<typeof RoverModelsConfigSchema>;

export interface MaskedProviderConfig {
  baseUrl: string;
  apiKey: string;
  api: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  models: ModelConfig[];
  hasKey: boolean;
  isEnvVar: boolean;
  [key: string]: unknown;
}

export interface MaskedRoverModelsConfig {
  active?: ActiveModelConfig;
  providers: Record<string, MaskedProviderConfig>;
  [key: string]: unknown;
}

export interface ModelConnectionTestResult {
  success: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}
