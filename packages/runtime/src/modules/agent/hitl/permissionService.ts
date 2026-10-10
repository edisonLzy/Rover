import fs from 'node:fs';
import picomatch from 'picomatch';
import { AbstractHumanInTheLoop } from './abstractHitl.js';
import { CommandClassifier } from '../runtime/tools/bash/classifier.js';
import { CommandRiskTier } from '../runtime/tools/bash/types.js';
import {
  type PermissionPayload,
  type DoomLoopPayload,
  type PermissionResolution,
  type DoomLoopResolution,
  type PermissionsConfigFile,
  getPermissionsConfigPath,
} from './types.js';

export interface PermissionServiceOptions {
  autoApprove?: string[];
  deny?: string[];
}

export class PermissionService extends AbstractHumanInTheLoop<
  'permission' | 'doom_loop',
  PermissionPayload | DoomLoopPayload,
  PermissionResolution | DoomLoopResolution
> {
  public readonly kind = 'permission' as const;

  private rememberedApprovals = new Set<string>();
  private autoApprovePatterns: string[] = [];
  private denyPatterns: string[] = [];

  // Track recent tool calls for doom loop guard: key -> { callCount, lastArgsJson }
  private recentToolCalls = new Map<string, { callCount: number; lastArgsJson: string }>();

  public override resolve(
    requestId: string,
    result: PermissionResolution | DoomLoopResolution
  ): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (pending && result.approved && 'remember' in result && result.remember) {
      const payload = pending.payload;
      if (payload.kind === 'permission' && payload.command) {
        this.rememberApproval(payload.command);
      }
    }
    return super.resolve(requestId, result);
  }

  constructor(options: PermissionServiceOptions = {}) {
    super();
    if (options.autoApprove) {
      this.autoApprovePatterns.push(...options.autoApprove);
    }
    if (options.deny) {
      this.denyPatterns.push(...options.deny);
    }
    this.loadConfigFile();
  }

  public loadConfigFile(): void {
    const configPath = getPermissionsConfigPath();

    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as PermissionsConfigFile;
        if (Array.isArray(parsed.autoApprove)) {
          this.autoApprovePatterns.push(...parsed.autoApprove);
        }
        if (Array.isArray(parsed.deny)) {
          this.denyPatterns.push(...parsed.deny);
        }
      }
    } catch {
      // ignore config loading errors
    }
  }

  public rememberApproval(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;
    this.rememberedApprovals.add(trimmed);

    // Also extract 2-token prefix (e.g. "gh pr" from "gh pr merge 42", "git push" from "git push origin")
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
      this.rememberedApprovals.add(`${words[0]} ${words[1]}`);
    } else {
      this.rememberedApprovals.add(words[0]);
    }
  }

  public isRemembered(command: string): boolean {
    const trimmed = command.trim();
    if (this.rememberedApprovals.has(trimmed)) {
      return true;
    }
    for (const prefix of this.rememberedApprovals) {
      if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
        return true;
      }
    }
    return false;
  }

  public isExplicitlyDenied(command: string): boolean {
    const trimmed = command.trim();
    if (this.denyPatterns.length === 0) return false;
    const isMatch = picomatch(this.denyPatterns);
    return isMatch(trimmed);
  }

  public isAutoApproved(command: string): boolean {
    const trimmed = command.trim();
    if (this.autoApprovePatterns.length === 0) return false;
    const isMatch = picomatch(this.autoApprovePatterns);
    return isMatch(trimmed);
  }

  public isAllowed(command: string): boolean {
    return this.isRemembered(command) || this.isAutoApproved(command);
  }

  public clearSessionMemory(): void {
    this.rememberedApprovals.clear();
    this.recentToolCalls.clear();
  }

  public async checkPermission(
    toolName: string,
    args: unknown,
    turnId?: string
  ): Promise<{ block?: boolean; reason?: string }> {
    // 1. Doom Loop Guard check
    const loopResult = await this.checkDoomLoop(toolName, args, turnId);
    if (loopResult.block) {
      return loopResult;
    }

    // 2. Controlled Bash Tool Action Guard
    if (toolName === 'bash') {
      const command = (args as Record<string, unknown>)?.command;
      if (typeof command === 'string') {
        return this.checkBashCommand(command, args as Record<string, unknown>);
      }
    }

    return { block: false };
  }

  private async checkDoomLoop(
    toolName: string,
    args: unknown,
    turnId?: string
  ): Promise<{ block?: boolean; reason?: string }> {
    const key = `${turnId ?? 'global'}:${toolName}`;
    const argsJson = JSON.stringify(args ?? {});
    const existing = this.recentToolCalls.get(key);

    if (existing && existing.lastArgsJson === argsJson) {
      existing.callCount += 1;
      if (existing.callCount >= 3) {
        // Trigger doom_loop HITL confirmation
        try {
          const resolution = (await this.request({
            kind: 'doom_loop',
            toolName,
            argsSummary: argsJson.slice(0, 200),
            callCount: existing.callCount,
            reason: `Tool '${toolName}' was called 3 consecutive times with identical arguments in this turn.`,
          })) as DoomLoopResolution;

          if (resolution.approved) {
            existing.callCount = 0;
            return { block: false };
          }
          return {
            block: true,
            reason: resolution.reason || 'Turn cancelled by user due to repetitive loop detection.',
          };
        } catch (err) {
          return {
            block: true,
            reason: err instanceof Error ? err.message : String(err),
          };
        }
      }
    } else {
      this.recentToolCalls.set(key, { callCount: 1, lastArgsJson: argsJson });
    }

    return { block: false };
  }

  private async checkBashCommand(
    command: string,
    args: Record<string, unknown>
  ): Promise<{ block?: boolean; reason?: string }> {
    const trimmed = command.trim();
    const classification = CommandClassifier.classify(trimmed);

    // Tier 3: Hard block without prompt
    if (classification.tier === CommandRiskTier.Forbidden) {
      return {
        block: true,
        reason:
          classification.reason ||
          `CommandBlockedError: '${trimmed}' matches Tier 3 forbidden blacklists. Escalation or destruction commands are strictly blocked.`,
      };
    }

    // Tier 1: Silent allow
    if (classification.tier === CommandRiskTier.ReadOnly) {
      return { block: false };
    }

    // Tier 2: Check explicit deny list first
    if (this.isExplicitlyDenied(trimmed)) {
      return {
        block: true,
        reason: `CommandDeniedError: Command '${trimmed}' matches explicit deny rule in permissions.json.`,
      };
    }

    // Tier 2: Check session memory or auto-approve patterns
    if (this.isAllowed(trimmed)) {
      return { block: false };
    }

    // Tier 2: Request user approval via HITL
    try {
      const resolution = (await this.request({
        kind: 'permission',
        toolName: 'bash',
        command: trimmed,
        args,
        tier: CommandRiskTier.Mutation,
        reason: classification.reason,
      })) as PermissionResolution;

      if (resolution.approved) {
        if (resolution.remember) {
          this.rememberApproval(trimmed);
        }
        return { block: false };
      }

      return {
        block: true,
        reason: resolution.reason || `Permission denied by user for command: '${trimmed}'`,
      };
    } catch (err) {
      return {
        block: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
