import fs from 'node:fs';
import path from 'node:path';
import { AbstractHumanInTheLoop } from './abstractHitl.js';
import {
  type WorkspaceAccessPayload,
  type WorkspaceAccessResolution,
  type PermissionsConfigFile,
  getPermissionsConfigPath,
} from './types.js';

export function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const resolvedChild = path.resolve(childPath);
  const resolvedParent = path.resolve(parentPath);
  if (resolvedChild === resolvedParent) return true;
  const rel = path.relative(resolvedParent, resolvedChild);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export class WorkspaceAccessService extends AbstractHumanInTheLoop<
  'workspace_access',
  WorkspaceAccessPayload,
  WorkspaceAccessResolution
> {
  public readonly kind = 'workspace_access' as const;
  private trustedWorkspaces = new Set<string>();

  public override resolve(requestId: string, result: WorkspaceAccessResolution): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (pending && result.approved && result.trustWorkspace) {
      if (pending.payload.resolvedPath) {
        this.persistTrustedWorkspace(pending.payload.resolvedPath);
      }
    }
    return super.resolve(requestId, result);
  }

  constructor() {
    super();
    this.loadConfigFile();
  }

  public loadConfigFile(): void {
    const targetPath = getPermissionsConfigPath();
    try {
      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        const parsed = JSON.parse(raw) as PermissionsConfigFile;
        if (Array.isArray(parsed.trustedWorkspaces)) {
          for (const ws of parsed.trustedWorkspaces) {
            this.addTrustedWorkspace(ws);
          }
        }
      }
    } catch {
      // ignore config loading errors
    }
  }

  public addTrustedWorkspace(dirPath: string): void {
    if (dirPath && typeof dirPath === 'string') {
      this.trustedWorkspaces.add(path.resolve(dirPath));
    }
  }

  public persistTrustedWorkspace(dirPath: string): void {
    this.addTrustedWorkspace(dirPath);
    const targetPath = getPermissionsConfigPath();
    try {
      let existing: PermissionsConfigFile = {};
      if (fs.existsSync(targetPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        } catch {
          existing = {};
        }
      } else {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      existing.trustedWorkspaces = Array.from(this.trustedWorkspaces);
      fs.writeFileSync(targetPath, JSON.stringify(existing, null, 2), 'utf-8');
    } catch {
      // ignore persistence errors
    }
  }

  public getTrustedWorkspaces(): string[] {
    return Array.from(this.trustedWorkspaces);
  }

  public isTrusted(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    // If no workspaces are explicitly configured, default to allow
    if (this.trustedWorkspaces.size === 0) {
      return true;
    }
    for (const trusted of this.trustedWorkspaces) {
      if (isPathInsideOrEqual(resolved, trusted)) {
        return true;
      }
    }
    return false;
  }

  public async checkAccess(
    toolName: string,
    args: unknown
  ): Promise<{ block?: boolean; reason?: string }> {
    if (!args || typeof args !== 'object') {
      return { block: false };
    }

    const rawPath =
      (args as Record<string, unknown>).cwd ||
      (args as Record<string, unknown>).filePath ||
      (args as Record<string, unknown>).path;

    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return { block: false };
    }

    const resolvedPath = path.resolve(rawPath);

    if (this.isTrusted(resolvedPath)) {
      return { block: false };
    }

    // Outside trusted workspaces -> trigger workspace_access HITL approval
    try {
      const resolution = await this.request({
        kind: 'workspace_access',
        toolName,
        targetPath: rawPath,
        resolvedPath,
        reason: `Target path '${resolvedPath}' is outside authorized workspaces.`,
      });

      if (resolution.approved) {
        if (resolution.trustWorkspace) {
          this.addTrustedWorkspace(resolvedPath);
        }
        return { block: false };
      }

      return {
        block: true,
        reason: resolution.reason || `Workspace access denied by user for path: ${resolvedPath}`,
      };
    } catch (err) {
      return {
        block: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
