import { router, publicProcedure, protectedProcedure } from './trpc.js';
import { RUNTIME_VERSION } from '../index.js';

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
});

export type AppRouter = typeof appRouter;
export type { Context } from './context.js';
