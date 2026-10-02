import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from './trpc.js';
import {
  RUNTIME_VERSION,
  resolveTerminalAction,
  executeTerminalAction,
  defaultSessionCarrier,
  defaultAgentRegistry,
  type AgentType,
} from '../index.js';

import {
  loadModelsConfig,
  maskModelsConfig,
  setActiveModel,
  saveProvider,
  deleteProvider,
  addModelToProvider,
  deleteModelFromProvider,
  testModelConnection,
  isPiConfigAvailable,
  getPiModelsConfigPath,
  importFromPi,
  ProviderConfigSchema,
  ModelConfigSchema,
} from '../models/index.js';

export const appRouter = router({
  // Unauthenticated ping for basic liveness check
  ping: publicProcedure.query(() => 'pong' as const),

  // Authenticated health check probe (requires valid loopback auth token)
  health: protectedProcedure.query(() => ({
    status: 'ok' as const,
    version: RUNTIME_VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })),

  // Models management router (Ticket 003 & ADR-0015)
  models: router({
    getConfig: protectedProcedure.query(() => {
      const config = loadModelsConfig();
      return maskModelsConfig(config);
    }),

    setActive: protectedProcedure
      .input(
        z.object({
          provider: z.string().min(1),
          model: z.string().min(1),
        })
      )
      .mutation(({ input }) => {
        const updated = setActiveModel(input);
        return maskModelsConfig(updated);
      }),

    saveProvider: protectedProcedure
      .input(
        z.object({
          id: z.string().min(1),
          provider: ProviderConfigSchema,
        })
      )
      .mutation(({ input }) => {
        const updated = saveProvider(input.id, input.provider);
        return maskModelsConfig(updated);
      }),

    deleteProvider: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ input }) => {
        const updated = deleteProvider(input.id);
        return maskModelsConfig(updated);
      }),

    addModel: protectedProcedure
      .input(
        z.object({
          providerId: z.string().min(1),
          model: ModelConfigSchema,
        })
      )
      .mutation(({ input }) => {
        const updated = addModelToProvider(input.providerId, input.model);
        return maskModelsConfig(updated);
      }),

    deleteModel: protectedProcedure
      .input(
        z.object({
          providerId: z.string().min(1),
          modelId: z.string().min(1),
        })
      )
      .mutation(({ input }) => {
        const updated = deleteModelFromProvider(input.providerId, input.modelId);
        return maskModelsConfig(updated);
      }),

    testConnection: protectedProcedure
      .input(
        z.object({
          provider: z.string().min(1),
          model: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        return testModelConnection(input);
      }),

    checkPiAvailability: protectedProcedure.query(() => {
      return {
        available: isPiConfigAvailable(),
        path: getPiModelsConfigPath(),
      };
    }),

    importFromPi: protectedProcedure
      .input(
        z
          .object({
            overwrite: z.boolean().optional(),
          })
          .optional()
      )
      .mutation(({ input }) => {
        const result = importFromPi({ overwrite: input?.overwrite });
        const config = loadModelsConfig();
        return {
          ...result,
          config: maskModelsConfig(config),
        };
      }),
  }),

  // Resolves whether clicking a task should attach to live Screen or resume via CLI
  resolveTerminalAction: protectedProcedure
    .input(
      z.object({
        attemptId: z.string(),
        agentType: z.enum(['claude', 'codex', 'opencode']),
        nativeSessionId: z.string().optional(),
        cwd: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return resolveTerminalAction({
        attemptId: input.attemptId,
        agentType: input.agentType as AgentType,
        nativeSessionId: input.nativeSessionId,
        cwd: input.cwd,
        carrier: defaultSessionCarrier,
        registry: defaultAgentRegistry,
      });
    }),

  // Executes the Terminal.app takeover / resume action on macOS
  executeTerminalAction: protectedProcedure
    .input(
      z.object({
        type: z.enum(['attach', 'resume']),
        attemptId: z.string(),
        sessionName: z.string(),
        command: z.string(),
        args: z.array(z.string()),
        cwd: z.string().optional(),
        agentType: z.enum(['claude', 'codex', 'opencode']),
        nativeSessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return executeTerminalAction(input);
    }),
});

export type AppRouter = typeof appRouter;
export type { Context } from './context.js';
