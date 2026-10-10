import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';

export const permissionsRouter = router({
  /**
   * 决算挂起的权限或工作区准入请求
   */
  resolve: protectedProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        approved: z.boolean(),
        remember: z.boolean().optional(),
        trustWorkspace: z.boolean().optional(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { requestId, approved, remember, trustWorkspace, reason } = input;
      const permissionService = ctx.container.agentService.runtime.getPermissionService();
      const workspaceAccessService = ctx.container.agentService.runtime.getWorkspaceAccessService();

      // 1. Check PermissionService
      if (permissionService.hasPending(requestId)) {
        const success = permissionService.resolve(requestId, {
          approved,
          remember,
          reason,
        });
        return { success, kind: 'permission' as const };
      }

      // 2. Check WorkspaceAccessService
      if (workspaceAccessService.hasPending(requestId)) {
        const success = workspaceAccessService.resolve(requestId, {
          approved,
          trustWorkspace,
          reason,
        });
        return { success, kind: 'workspace_access' as const };
      }

      return { success: false, kind: null };
    }),

  /**
   * 获取所有等待用户审批的挂起请求
   */
  getPendingRequests: protectedProcedure.query(({ ctx }) => {
    const permissionService = ctx.container.agentService.runtime.getPermissionService();
    const workspaceAccessService = ctx.container.agentService.runtime.getWorkspaceAccessService();
    const permissionRequests = permissionService.getPendingRequests();
    const workspaceRequests = workspaceAccessService.getPendingRequests();
    return [...permissionRequests, ...workspaceRequests];
  }),

  /**
   * 获取当前受信工作区列表
   */
  getTrustedWorkspaces: protectedProcedure.query(({ ctx }) => {
    return ctx.container.agentService.runtime.getWorkspaceAccessService().getTrustedWorkspaces();
  }),
});
