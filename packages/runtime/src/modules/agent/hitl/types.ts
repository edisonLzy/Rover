import os from 'node:os';
import path from 'node:path';
import { CommandRiskTier } from '../runtime/tools/bash/types.js';

export type HitlKind = 'permission' | 'workspace_access' | 'doom_loop';

export interface BaseHitlPayload {
  kind: HitlKind;
  toolName: string;
  reason?: string;
}

export interface PermissionPayload extends BaseHitlPayload {
  kind: 'permission';
  command?: string;
  args?: Record<string, unknown>;
  tier: CommandRiskTier.Mutation;
}

export interface WorkspaceAccessPayload extends BaseHitlPayload {
  kind: 'workspace_access';
  targetPath: string;
  resolvedPath: string;
}

export interface DoomLoopPayload extends BaseHitlPayload {
  kind: 'doom_loop';
  argsSummary: string;
  callCount: number;
}

export type HitlPayload = PermissionPayload | WorkspaceAccessPayload | DoomLoopPayload;

export interface PermissionResolution {
  approved: boolean;
  remember?: boolean;
  reason?: string;
}

export interface WorkspaceAccessResolution {
  approved: boolean;
  trustWorkspace?: boolean;
  reason?: string;
}

export interface DoomLoopResolution {
  approved: boolean;
  reason?: string;
}

export type HitlResolution = PermissionResolution | WorkspaceAccessResolution | DoomLoopResolution;

export interface PendingRequest<TPayload, TResult> {
  requestId: string;
  payload: TPayload;
  createdAt: number;
  resolve: (result: TResult) => void;
  reject: (error: Error) => void;
}

export interface PermissionRequestEvent {
  requestId: string;
  payload: HitlPayload;
  createdAt: number;
}

export interface PermissionsConfigFile {
  autoApprove?: string[];
  deny?: string[];
  trustedWorkspaces?: string[];
}

/**
 * 获取 permissions 配置文件持久化路径
 * 默认固定为 ~/.rover/permissions.json，支持 ROVER_PERMISSIONS_CONFIG_PATH 环境变量覆盖（供测试隔离使用）
 */
export function getPermissionsConfigPath(): string {
  if (process.env.ROVER_PERMISSIONS_CONFIG_PATH) {
    return path.resolve(process.env.ROVER_PERMISSIONS_CONFIG_PATH);
  }
  return path.join(os.homedir(), '.rover', 'permissions.json');
}
