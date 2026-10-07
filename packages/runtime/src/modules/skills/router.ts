import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../../transport/trpc.js';

export const skillsRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return ctx.container.skills.list();
  }),

  read: protectedProcedure.input(z.object({ name: z.string().min(1) })).query(({ ctx, input }) => {
    const skill = ctx.container.skills.read(input.name);
    if (!skill) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Skill not found: ${input.name}`,
      });
    }
    return skill;
  }),
});
