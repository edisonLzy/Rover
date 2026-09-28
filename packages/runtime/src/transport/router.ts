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
