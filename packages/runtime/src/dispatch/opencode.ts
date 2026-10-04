/**
 * OpenCode CLI Adapter.
 *
 * Implements OpenCode CLI dispatching, session binding,
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

export class OpenCodeAdapter implements AgentAdapter {
  readonly agentType: AgentType = 'opencode';
  readonly defaultSessionIdStrategy: SessionIdStrategy = 'preallocated';

  async resolveCliPath(customPath?: string): Promise<string> {
    if (customPath && fs.existsSync(customPath)) {
      return customPath;
    }

    if (process.env.ROVER_OPENCODE_PATH && fs.existsSync(process.env.ROVER_OPENCODE_PATH)) {
      return process.env.ROVER_OPENCODE_PATH;
    }

    const opencodeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
    if (fs.existsSync(opencodeBin)) {
      return opencodeBin;
    }

    try {
      const { stdout } = await execFileAsync('which', ['opencode']);
      const trimmed = stdout.trim();
      if (trimmed && fs.existsSync(trimmed)) {
        return trimmed;
      }
    } catch {
      // Ignore which failure
    }

    return 'opencode';
  }

  async buildLaunchSpec(
    options: DispatchOptions,
    context: AgentAdapterContext
  ): Promise<LaunchSpec> {
    const command = await this.resolveCliPath(options.cliPath);

    const args: string[] = ['--auto'];

    if (context.preallocatedSessionId) {
      args.push('-s', context.preallocatedSessionId);
    }

    if (options.prompt && options.prompt.trim()) {
      args.push('--prompt', options.prompt.trim());
    }

    if (options.extraArgs && options.extraArgs.length > 0) {
      args.push(...options.extraArgs);
    }

    // Pass target directory as positional project argument
    args.push(options.cwd);

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
      args: ['--auto', '-s', nativeSessionId.trim()],
    };
  }
}
