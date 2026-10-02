import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadModelsConfig,
  saveModelsConfig,
  resolveApiKey,
  maskApiKey,
  maskModelsConfig,
  setActiveModel,
  saveProvider,
  deleteProvider,
  addModelToProvider,
  deleteModelFromProvider,
} from '../models/config.js';
import { importFromPi, isPiConfigAvailable } from '../models/importer.js';
import { testModelConnection } from '../models/tester.js';
import type { RoverModelsConfig } from '../models/types.js';

describe('Model Configuration & Pi AI Contract (Ticket 003 & ADR-0015)', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-model-test-'));
    configPath = path.join(tempDir, 'models.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('File Management & Atomic Write', () => {
    it('initializes default configuration file when none exists', () => {
      expect(fs.existsSync(configPath)).toBe(false);

      const config = loadModelsConfig(configPath);
      expect(fs.existsSync(configPath)).toBe(true);
      expect(config.active?.provider).toBe('deepseek');
      expect(config.providers.deepseek).toBeDefined();

      // Check file permissions (POSIX mode 0600 = 33152 or 384)
      const stats = fs.statSync(configPath);
      const isOwnerReadWrite = (stats.mode & 0o600) === 0o600;
      expect(isOwnerReadWrite).toBe(true);
    });

    it('atomically saves configuration and preserves unknown extension fields', () => {
      const customConfig: RoverModelsConfig & { customMeta: string } = {
        active: { provider: 'test-prov', model: 'test-mod' },
        customMeta: 'custom_value_preserved',
        providers: {
          'test-prov': {
            baseUrl: 'https://example.com/v1',
            apiKey: 'test-key',
            api: 'openai-completions',
            customProviderMeta: 42,
            models: [
              {
                id: 'test-mod',
                name: 'Test Model',
                contextWindow: 32000,
                maxTokens: 4096,
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0 },
              },
            ],
          } as any,
        },
      };

      saveModelsConfig(customConfig as RoverModelsConfig, configPath);

      const reloaded = loadModelsConfig(configPath);
      expect(reloaded.active?.provider).toBe('test-prov');
      expect((reloaded as any).customMeta).toBe('custom_value_preserved');
      expect((reloaded.providers['test-prov'] as any).customProviderMeta).toBe(42);
    });
  });

  describe('Environment Variable Resolution & Masking', () => {
    it('resolves literal keys and ${ENV_VAR} patterns', () => {
      process.env.TEST_ROVER_API_KEY = 'secret-env-token-12345';

      expect(resolveApiKey('literal-key')).toBe('literal-key');
      expect(resolveApiKey('${TEST_ROVER_API_KEY}')).toBe('secret-env-token-12345');
      expect(resolveApiKey('${NON_EXISTENT_VAR}')).toBe('');
      expect(resolveApiKey('')).toBe('');

      delete process.env.TEST_ROVER_API_KEY;
    });

    it('masks keys securely and reports hasKey status', () => {
      process.env.TEST_OPENAI_KEY = 'sk-abcdef1234567890xyz';

      expect(maskApiKey('')).toBe('');
      expect(maskApiKey('1234')).toBe('••••••••');
      expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1••••••••cdef');
      expect(maskApiKey('${TEST_OPENAI_KEY}')).toBe('${TEST_OPENAI_KEY}');

      const masked = maskModelsConfig({
        providers: {
          p1: {
            baseUrl: 'https://p1.com',
            apiKey: 'sk-1234567890abcdef',
            api: 'openai-completions',
            models: [],
          },
          p2: {
            baseUrl: 'https://p2.com',
            apiKey: '${TEST_OPENAI_KEY}',
            api: 'openai-completions',
            models: [],
          },
          p3: {
            baseUrl: 'https://p3.com',
            apiKey: '${MISSING_ENV_VAR}',
            api: 'openai-completions',
            models: [],
          },
        },
      });

      expect(masked.providers.p1.apiKey).toBe('sk-1••••••••cdef');
      expect(masked.providers.p1.hasKey).toBe(true);
      expect(masked.providers.p1.isEnvVar).toBe(false);

      expect(masked.providers.p2.apiKey).toBe('${TEST_OPENAI_KEY}');
      expect(masked.providers.p2.hasKey).toBe(true);
      expect(masked.providers.p2.isEnvVar).toBe(true);

      expect(masked.providers.p3.apiKey).toBe('${MISSING_ENV_VAR}');
      expect(masked.providers.p3.hasKey).toBe(false);
      expect(masked.providers.p3.isEnvVar).toBe(true);

      delete process.env.TEST_OPENAI_KEY;
    });
  });

  describe('CRUD Operations', () => {
    it('sets active model and updates provider configs', () => {
      loadModelsConfig(configPath);

      setActiveModel({ provider: 'deepseek', model: 'deepseek-reasoner' }, configPath);
      let config = loadModelsConfig(configPath);
      expect(config.active?.model).toBe('deepseek-reasoner');

      saveProvider(
        'ollama',
        {
          baseUrl: 'http://localhost:11434',
          apiKey: '',
          api: 'openai-completions',
          models: [
            {
              id: 'llama3',
              name: 'Llama 3',
              contextWindow: 8192,
              maxTokens: 2048,
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0 },
            },
          ],
        },
        configPath
      );

      config = loadModelsConfig(configPath);
      expect(config.providers.ollama).toBeDefined();
      expect(config.providers.ollama.models[0].name).toBe('Llama 3');

      deleteProvider('deepseek', configPath);
      config = loadModelsConfig(configPath);
      expect(config.providers.deepseek).toBeUndefined();
      // Active was deepseek, so active should be cleared
      expect(config.active).toBeUndefined();
    });
  });

  describe('Pi CLI Importer', () => {
    it('imports providers from an external Pi models.json without destroying existing Rover providers', () => {
      const piConfigPath = path.join(tempDir, 'pi-models.json');
      const piConfig = {
        providers: {
          minimax: {
            baseUrl: 'https://api.minimaxi.com/anthropic',
            apiKey: 'sk-minimax-pi-key',
            api: 'anthropic-messages',
            models: [
              {
                id: 'MiniMax-M2.7-highspeed',
                name: 'MiniMax-M2.7',
                reasoning: false,
                input: ['text'],
                contextWindow: 1000000,
                maxTokens: 16384,
                cost: { input: 0, output: 0 },
              },
            ],
          },
        },
      };
      fs.writeFileSync(piConfigPath, JSON.stringify(piConfig, null, 2));

      expect(isPiConfigAvailable(piConfigPath)).toBe(true);

      const result = importFromPi({
        piConfigPath,
        roverConfigPath: configPath,
      });

      expect(result.importedProviders).toEqual(['minimax']);
      expect(result.totalModels).toBe(1);

      const roverConfig = loadModelsConfig(configPath);
      expect(roverConfig.providers.minimax).toBeDefined();
      expect(roverConfig.providers.deepseek).toBeDefined(); // existing preserved
      expect(roverConfig.providers.minimax.models[0].id).toBe('MiniMax-M2.7-highspeed');
    });
  });

  describe('Connectivity Tester', () => {
    it('returns error when provider or model does not exist or apiKey is missing', async () => {
      saveModelsConfig(
        {
          providers: {
            test: {
              baseUrl: 'https://api.test.com',
              apiKey: '',
              api: 'openai-completions',
              models: [
                {
                  id: 'm1',
                  name: 'M1',
                  contextWindow: 4096,
                  maxTokens: 1024,
                  reasoning: false,
                  input: ['text'],
                  cost: { input: 0, output: 0 },
                },
              ],
            },
          },
        },
        configPath
      );

      const notFoundProv = await testModelConnection({
        provider: 'unknown',
        model: 'm1',
        customConfigPath: configPath,
      });
      expect(notFoundProv.success).toBe(false);
      expect(notFoundProv.error).toContain('未在配置中找到');

      const noKey = await testModelConnection({
        provider: 'test',
        model: 'm1',
        customConfigPath: configPath,
      });
      expect(noKey.success).toBe(false);
      expect(noKey.error).toContain('API Key 为空');
    });

    it('measures latency and returns success on 200 response', async () => {
      saveModelsConfig(
        {
          providers: {
            test: {
              baseUrl: 'https://mock.api.com',
              apiKey: 'sk-test-key',
              api: 'openai-completions',
              models: [
                {
                  id: 'm1',
                  name: 'M1',
                  contextWindow: 4096,
                  maxTokens: 1024,
                  reasoning: false,
                  input: ['text'],
                  cost: { input: 0, output: 0 },
                },
              ],
            },
          },
        },
        configPath
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'pong' } }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await testModelConnection({
        provider: 'test',
        model: 'm1',
        customConfigPath: configPath,
      });

      expect(res.success).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe('Model Addition & Deletion in Provider', () => {
    it('adds and updates models within a provider', () => {
      loadModelsConfig(configPath);

      // Add a new model to deepseek
      addModelToProvider(
        'deepseek',
        {
          id: 'deepseek-coder',
          name: 'DeepSeek Coder',
          contextWindow: 128000,
          maxTokens: 8192,
          reasoning: false,
          input: ['text'],
          cost: { input: 0.1, output: 0.2 },
        },
        configPath
      );

      let config = loadModelsConfig(configPath);
      expect(config.providers.deepseek.models.length).toBe(3);
      expect(config.providers.deepseek.models.find((m) => m.id === 'deepseek-coder')).toBeDefined();

      // Update existing model
      addModelToProvider(
        'deepseek',
        {
          id: 'deepseek-coder',
          name: 'DeepSeek Coder V2',
          contextWindow: 128000,
          maxTokens: 8192,
          reasoning: false,
          input: ['text'],
          cost: { input: 0.1, output: 0.2 },
        },
        configPath
      );

      config = loadModelsConfig(configPath);
      expect(config.providers.deepseek.models.length).toBe(3);
      expect(config.providers.deepseek.models.find((m) => m.id === 'deepseek-coder')?.name).toBe(
        'DeepSeek Coder V2'
      );
    });

    it('deletes a model from a provider and clears active if it was active', () => {
      loadModelsConfig(configPath);

      // Active is deepseek:deepseek-chat
      let config = loadModelsConfig(configPath);
      expect(config.active?.model).toBe('deepseek-chat');

      // Delete active model
      deleteModelFromProvider('deepseek', 'deepseek-chat', configPath);

      config = loadModelsConfig(configPath);
      expect(
        config.providers.deepseek.models.find((m) => m.id === 'deepseek-chat')
      ).toBeUndefined();
      expect(config.active).toBeUndefined();
    });
  });
});
