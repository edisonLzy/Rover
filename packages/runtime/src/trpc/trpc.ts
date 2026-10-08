import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Authentication middleware enforcing valid Bearer Token for protected procedures.
 */
const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.isAuthenticated) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized: missing or invalid loopback authentication token',
    });
  }
  return next({
    ctx: {
      ...ctx,
      isAuthenticated: true as const,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);
