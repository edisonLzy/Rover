/**
 * OpenAI Codex CLI Adapter.
 *
 * Implements Codex CLI dispatching, deferred session binding via SessionStart hook,
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

export class CodexAdapter implements AgentAdapter {
  readonly agentType: AgentType = 'codex';
  readonly defaultSessionIdStrategy: SessionIdStrategy = 'deferred';

  async resolveCliPath(customPath?: string): Promise<string> {
    if (customPath && fs.existsSync(customPath)) {
      return customPath;
    }

    if (process.env.ROVER_CODEX_PATH && fs.existsSync(process.env.ROVER_CODEX_PATH)) {
      return process.env.ROVER_CODEX_PATH;
    }

    const bunBin = path.join(os.homedir(), '.bun', 'bin', 'codex');
    if (fs.existsSync(bunBin)) {
      return bunBin;
    }

    try {
      const { stdout } = await execFileAsync('which', ['codex']);
      const trimmed = stdout.trim();
      if (trimmed && fs.existsSync(trimmed)) {
        return trimmed;
      }
    } catch {
      // Ignore which failure
    }

    return 'codex';
  }

  async buildLaunchSpec(
    options: DispatchOptions,
    context: AgentAdapterContext
  ): Promise<LaunchSpec> {
    const command = await this.resolveCliPath(options.cliPath);

    const args: string[] = ['--dangerously-bypass-approvals-and-sandbox', '-C', options.cwd];

    if (options.prompt && options.prompt.trim()) {
      args.push(options.prompt.trim());
    }

    if (options.extraArgs && options.extraArgs.length > 0) {
      args.push(...options.extraArgs);
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
      args: ['resume', '--dangerously-bypass-approvals-and-sandbox', nativeSessionId.trim()],
    };
  }
}
