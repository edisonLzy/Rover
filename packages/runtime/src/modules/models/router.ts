import { z } from 'zod';
import { router, protectedProcedure } from '../../transport/trpc.js';
import { ProviderConfigSchema, ModelConfigSchema } from './schema.js';
import type { ProviderConfig, ModelConfig } from './types.js';

export const modelsRouter = router({
  getConfig: protectedProcedure.query(({ ctx }) => {
    return ctx.container.models.getMaskedConfig();
  }),

  getActive: protectedProcedure.query(({ ctx }) => {
    return ctx.container.models.getActiveModel();
  }),

  setActive: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1),
        model: z.string().min(1),
      })
    )
    .mutation(({ ctx, input }) => {
      return ctx.container.models.setActive(input);
    }),

  saveProvider: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        provider: ProviderConfigSchema,
      })
    )
    .mutation(({ ctx, input }) => {
      return ctx.container.models.saveProvider(input.id, input.provider as ProviderConfig);
    }),

  deleteProvider: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return ctx.container.models.deleteProvider(input.id);
    }),

  addModel: protectedProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        model: ModelConfigSchema,
      })
    )
    .mutation(({ ctx, input }) => {
      return ctx.container.models.addModel(input.providerId, input.model as ModelConfig);
    }),

  deleteModel: protectedProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
      })
    )
    .mutation(({ ctx, input }) => {
      return ctx.container.models.deleteModel(input.providerId, input.modelId);
    }),

  testConnection: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1),
        model: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.container.models.testConnection(input);
    }),

  checkPiAvailability: protectedProcedure.query(({ ctx }) => {
    return ctx.container.models.checkPiAvailability();
  }),

  importFromPi: protectedProcedure
    .input(
      z
        .object({
          overwrite: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(({ ctx, input }) => {
      return ctx.container.models.importFromPi(input);
    }),
});
