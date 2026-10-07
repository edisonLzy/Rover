import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../../transport/trpc.js';
import { PromptDocumentV1Schema } from '../../types/prompt.js';

export const turnsRouter = router({
  start: protectedProcedure
    .input(
      z.object({
        promptDoc: PromptDocumentV1Schema,
        turnId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.container.agent.startTurn({
          promptDoc: input.promptDoc,
          turnId: input.turnId,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('No active model configured')) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No active model configured in ~/.rover/models.json',
          });
        }
        throw err;
      }
    }),

  cancel: protectedProcedure
    .input(z.object({ turnId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return ctx.container.agent.cancelTurn(input.turnId);
    }),

  steer: protectedProcedure
    .input(
      z.object({
        content: z.string().min(1),
      })
    )
    .mutation(({ ctx, input }) => {
      return ctx.container.agent.steer(input.content);
    }),

  followUp: protectedProcedure
    .input(
      z.object({
        content: z.string().min(1),
      })
    )
    .mutation(({ ctx, input }) => {
      return ctx.container.agent.followUp(input.content);
    }),

  clearAllQueues: protectedProcedure.mutation(({ ctx }) => {
    return ctx.container.agent.clearAllQueues();
  }),

  get: protectedProcedure.input(z.object({ turnId: z.string().min(1) })).query(({ ctx, input }) => {
    return ctx.container.agent.getTurn(input.turnId);
  }),
});

export const historyRouter = router({
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
    .query(({ ctx, input }) => {
      return ctx.container.agent.getFeed(input);
    }),

  getStats: protectedProcedure.query(({ ctx }) => {
    return ctx.container.agent.getStats();
  }),

  getEffective: protectedProcedure.query(({ ctx }) => {
    return ctx.container.agent.getEffectiveHistory();
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
    .query(({ ctx, input }) => {
      return ctx.container.agent.listTurns(input);
    }),

  getTurn: protectedProcedure
    .input(z.object({ turnId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.container.agent.getTurn(input.turnId);
    }),
});
