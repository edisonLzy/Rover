import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../../transport/trpc.js';
import { TaskServiceError } from './service.js';

export const tasksRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(50),
          status: z
            .enum(['running', 'needs_intervention', 'completed', 'failed', 'unverified'])
            .optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => mapTaskErrors(() => ctx.container.taskService.list(input ?? {}))),

  get: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(({ ctx, input }) => mapTaskErrors(() => ctx.container.taskService.get(input.taskId))),

  openTerminal: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      mapTaskErrors(() => ctx.container.taskService.openTerminal(input.taskId))
    ),
});

async function mapTaskErrors<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TaskServiceError) {
      throw new TRPCError({
        code: error.code === 'TASK_NOT_FOUND' ? 'NOT_FOUND' : 'PRECONDITION_FAILED',
        message: error.message,
        cause: error,
      });
    }
    throw error;
  }
}
