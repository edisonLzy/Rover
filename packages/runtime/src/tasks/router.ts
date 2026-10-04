import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../transport/trpc.js';
import { getDefaultDatabase } from '../storage/db.js';
import { defaultSessionCarrier } from '../dispatch/carrier.js';
import { defaultAgentRegistry } from '../dispatch/dispatcher.js';
import { executeTerminalAction } from '../dispatch/terminal.js';
import { createTaskService, TaskServiceError, type TaskService } from './service.js';

export function createTasksRouter(service: TaskService) {
  return router({
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
      .query(({ input }) => mapTaskErrors(() => service.list(input ?? {}))),

    get: protectedProcedure
      .input(z.object({ taskId: z.string().min(1) }))
      .query(({ input }) => mapTaskErrors(() => service.get(input.taskId))),

    openTerminal: protectedProcedure
      .input(z.object({ taskId: z.string().min(1) }))
      .mutation(({ input }) => mapTaskErrors(() => service.openTerminal(input.taskId))),
  });
}

export const tasksRouter = createTasksRouter(
  createTaskService({
    getDatabase: () => getDefaultDatabase().raw,
    carrier: defaultSessionCarrier,
    registry: defaultAgentRegistry,
    executeTerminal: executeTerminalAction,
  })
);

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
