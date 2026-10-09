import { z } from 'zod';
import { router, protectedProcedure } from '../../transport/trpc.js';

export const inboxRouter = router({
  /**
   * 查询收件箱消息列表（支持分页与状态过滤）
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(50).optional(),
          offset: z.number().min(0).default(0).optional(),
          status: z.enum(['all', 'unread', 'read', 'delegated', 'resolved']).optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      return ctx.container.inboxService.listMessages(input ?? {});
    }),

  /**
   * 获取当前未读消息计数
   */
  getUnreadCount: protectedProcedure.query(({ ctx }) => {
    return ctx.container.inboxService.getUnreadCount();
  }),

  /**
   * 批量将指定消息标记为已读
   */
  markAsRead: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)),
      })
    )
    .mutation(({ ctx, input }) => {
      ctx.container.inboxService.markAsRead(input.ids);
      return { success: true };
    }),

  /**
   * 将指定消息标记为已交办（开启 Rover 回合，此时不关联 Task ID）
   */
  markAsDelegated: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
      })
    )
    .mutation(({ ctx, input }) => {
      const success = ctx.container.inboxService.markAsDelegated(input.id);
      return { success };
    }),

  /**
   * 将指定消息与已创建的 Task ID 关联（在 Coding Agent 派发后调用）
   */
  linkTask: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        taskId: z.string().min(1),
      })
    )
    .mutation(({ ctx, input }) => {
      const success = ctx.container.inboxService.linkTask(input.id, input.taskId);
      return { success };
    }),

  /**
   * 获取企业微信消息来源配置及当前运行连接状态
   * 默认对 botSecret 进行掩码脱敏，传入 unmask: true 时获取明文
   */
  getWecomConfig: protectedProcedure
    .input(
      z
        .object({
          unmask: z.boolean().optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      const config = ctx.container.inboxService.getWecomConfig(input);
      const status = ctx.container.inboxService.getProviderStatus('wecom');
      return {
        ...config,
        status,
      };
    }),

  /**
   * 更新企业微信消息来源配置并动态启停长连接
   */
  updateWecomConfig: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        botId: z.string().optional(),
        botSecret: z.string().optional(),
        wsUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.container.inboxService.applyWecomConfig(input);
      const config = ctx.container.inboxService.getWecomConfig();
      const status = ctx.container.inboxService.getProviderStatus('wecom');
      return {
        ...config,
        status,
      };
    }),

  /**
   * 测试企业微信配置握手连通性（不干扰当前主长连接）
   */
  testWecomConnection: protectedProcedure
    .input(
      z
        .object({
          botId: z.string().optional(),
          botSecret: z.string().optional(),
          wsUrl: z.string().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.container.inboxService.testWecomConnection(input);
    }),
});
