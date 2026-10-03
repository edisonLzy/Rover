import { z } from 'zod';
import { TRPCError } from '@trpc/server';
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
import { getDefaultTurnEngine } from '../agent/index.js';
import { PromptDocumentV1Schema } from '../types/prompt.js';
import {
  listEntries,
  getHistoryStats,
  listRoverTurns,
  getEffectiveHistory,
  getRoverTurn,
  getTurnEntries,
  getDefaultDatabase,
} from '../storage/index.js';
import crypto from 'node:crypto';

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

  skills: router({
    list: protectedProcedure.query(() =>
      getDefaultTurnEngine()
        .getSkillService()
        .getSkills()
        .map(({ id, name, description }) => ({
          id,
          name,
          description,
          source: 'builtin' as const,
          isEnabled: true,
        }))
    ),
    read: protectedProcedure.input(z.object({ name: z.string().min(1) })).query(({ input }) => {
      const body = getDefaultTurnEngine().getSkillService().readSkillBody(input.name);
      if (body === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Skill not found: ${input.name}` });
      }
      return { name: input.name, body };
    }),
  }),

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

  // Rover Turns & Pi Agent Loop router (Ticket 005)
  turns: router({
    start: protectedProcedure
      .input(
        z.object({
          promptDoc: PromptDocumentV1Schema,
          turnId: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const engine = getDefaultTurnEngine();
        const turnId = input.turnId || crypto.randomUUID();
        // Fire-and-forget background execution, frontend subscribes via WebSocket
        void engine.executeTurn({
          turnId,
          promptDoc: input.promptDoc,
        });
        return {
          turnId,
          status: 'running' as const,
        };
      }),

    cancel: protectedProcedure
      .input(z.object({ turnId: z.string().min(1) }))
      .mutation(({ input }) => {
        const engine = getDefaultTurnEngine();
        const success = engine.cancelTurn(input.turnId);
        return { success, turnId: input.turnId };
      }),

    get: protectedProcedure.input(z.object({ turnId: z.string().min(1) })).query(({ input }) => {
      const engine = getDefaultTurnEngine();
      return engine.getTurnDetails(input.turnId);
    }),
  }),

  // Rover History & Compaction router (Ticket 004 & Dashboard)
  history: router({
    getFeed: protectedProcedure
      .input(
        z
          .object({
            limit: z.number().min(1).max(200).default(100),
            offset: z.number().min(0).default(0),
            turnId: z.string().optional(),
            type: z.enum(['message', 'compaction']).optional(),
            order: z.enum(['asc', 'desc']).default('asc'),
          })
          .optional()
      )
      .query(({ input }) => {
        const db = getDefaultDatabase().raw;
        return listEntries(db, input ?? {});
      }),

    getStats: protectedProcedure.query(() => {
      const db = getDefaultDatabase().raw;
      return getHistoryStats(db);
    }),

    getEffective: protectedProcedure.query(() => {
      const db = getDefaultDatabase().raw;
      return getEffectiveHistory(db);
    }),

    listTurns: protectedProcedure
      .input(
        z
          .object({
            limit: z.number().min(1).max(100).default(30),
            offset: z.number().min(0).default(0),
          })
          .optional()
      )
      .query(({ input }) => {
        const db = getDefaultDatabase().raw;
        return listRoverTurns(db, input ?? {});
      }),

    getTurn: protectedProcedure
      .input(z.object({ turnId: z.string().min(1) }))
      .query(({ input }) => {
        const db = getDefaultDatabase().raw;
        const turn = getRoverTurn(db, input.turnId);
        const entries = getTurnEntries(db, input.turnId);
        return { turn, entries };
      }),
  }),
});

export type AppRouter = typeof appRouter;
export type { Context } from './context.js';
