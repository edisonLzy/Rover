/**
 * Claude Code CLI Adapter.
 *
 * Implements Claude Code specific dispatching, preallocated UUID session binding,
 * and resume specifications per Rover MVP TRD Section 5.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgentAdapter,
  AgentAdapterContext,
  AgentType,
  DispatchOptions,
  LaunchSpec,
  SessionIdStrategy,
} from './types.js';

const execFileAsync = promisify(execFile);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClaudeAdapter implements AgentAdapter {
  readonly agentType: AgentType = 'claude';
  readonly defaultSessionIdStrategy: SessionIdStrategy = 'preallocated';

  async resolveCliPath(customPath?: string): Promise<string> {
    if (customPath && fs.existsSync(customPath)) {
      return customPath;
    }

    if (process.env.ROVER_CLAUDE_PATH && fs.existsSync(process.env.ROVER_CLAUDE_PATH)) {
      return process.env.ROVER_CLAUDE_PATH;
    }

    const homeLocalBin = path.join(os.homedir(), '.local', 'bin', 'claude');
    if (fs.existsSync(homeLocalBin)) {
      return homeLocalBin;
    }

    try {
      const { stdout } = await execFileAsync('which', ['claude']);
      const trimmed = stdout.trim();
      if (trimmed && fs.existsSync(trimmed)) {
        return trimmed;
      }
    } catch {
      // Ignore which failure
    }

    return 'claude';
  }

  async buildLaunchSpec(
    options: DispatchOptions,
    context: AgentAdapterContext
  ): Promise<LaunchSpec> {
    const command = await this.resolveCliPath(options.cliPath);

    const sessionId = context.preallocatedSessionId;
    if (!sessionId) {
      throw new Error('Claude Code dispatch requires a preallocated session UUID');
    }

    if (!UUID_REGEX.test(sessionId)) {
      throw new Error(`Invalid UUID provided for Claude session-id: ${sessionId}`);
    }

    // Background work must not wait for interactive workspace trust or tool approval.
    const args: string[] = ['--print', '--dangerously-skip-permissions', '--session-id', sessionId];

    if (options.prompt && options.prompt.trim()) {
      args.push(options.prompt.trim());
    }

    if (options.extraArgs && options.extraArgs.length > 0) {
      args.push(
        ...options.extraArgs.filter(
          (arg) => arg !== '--dangerously-skip-permissions' && arg !== '--print'
        )
      );
    }

    const env: Record<string, string> = {
      ROVER_DISPATCH_ATTEMPT_ID: context.attemptId,
      ROVER_REPORT_TOKEN: context.reportToken,
      ROVER_RESERVED_TASK_UUID: context.reservedTaskUuid,
      ROVER_AGENT_TYPE: this.agentType,
      ...options.extraEnv,
    };

    return {
      command,
      args,
      cwd: options.cwd,
      env,
    };
  }

  async getResumeSpec(nativeSessionId: string, customPath?: string): Promise<LaunchSpec> {
    if (!nativeSessionId || !nativeSessionId.trim()) {
      throw new Error('Cannot construct resume spec without a native session ID');
    }

    const command = await this.resolveCliPath(customPath);
    return {
      command,
      args: ['--dangerously-skip-permissions', '--resume', nativeSessionId.trim()],
    };
  }
}
