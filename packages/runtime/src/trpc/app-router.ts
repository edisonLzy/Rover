import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from './trpc.js';
import { skillsRouter } from '../modules/skills/index.js';
import { modelsRouter } from '../modules/models/index.js';
import { tasksRouter } from '../modules/tasks/index.js';
import { turnsRouter, historyRouter } from '../modules/agent/index.js';
import { inboxRouter } from '../modules/inbox/index.js';
import { permissionsRouter } from './routers/permissions.js';
import {
  resolveTerminalAction,
  executeTerminalAction,
} from '../infrastructure/dispatch/terminal.js';
import type { TaskAgent } from '../modules/tasks/types.js';

export const RUNTIME_VERSION = '0.1.0';

export const appRouter = router({
  // Health & Heartbeat procedures
  ping: publicProcedure.query(() => 'pong'),

  health: protectedProcedure.query(() => ({
    status: 'ok' as const,
    version: RUNTIME_VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })),

  // Sub-routers
  skills: skillsRouter,
  models: modelsRouter,
  tasks: tasksRouter,
  turns: turnsRouter,
  history: historyRouter,
  inbox: inboxRouter,
  permissions: permissionsRouter,

  // Resolves the exact Terminal execution command for a running/stopped carrier session
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
        agentType: input.agentType as TaskAgent,
        nativeSessionId: input.nativeSessionId,
        cwd: input.cwd,
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
