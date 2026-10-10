import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ExecBashParams, type ExecBashParamsType } from './types.js';
import { CommandClassifier } from './classifier.js';
import { SafeRunner } from './runner.js';

export function createBashTool(): AgentTool<typeof ExecBashParams> {
  return {
    name: 'bash',
    label: 'Execute Controlled Bash Command',
    description:
      'Execute a non-interactive bash/zsh command in the workspace. Read-only commands (git status, gh pr view, curl -I, etc.) execute immediately. Destructive commands are blocked.',
    parameters: ExecBashParams,
    async execute(_toolCallId: string, params: ExecBashParamsType) {
      const command = params.command?.trim();
      if (!command) {
        return {
          content: [{ type: 'text', text: 'Error: Parameter "command" cannot be empty.' }],
          details: { error: 'empty_command' },
        };
      }

      // 1. Classify command
      const classification = CommandClassifier.classify(command);

      // 2. Handle Tier 3 (Forbidden Blacklist)
      if (classification.tier === 'tier_3') {
        const errorText = `CommandBlockedError: '${command}' matches Tier 3 forbidden blacklists. Escalation or destruction commands are strictly blocked.`;
        return {
          content: [{ type: 'text', text: errorText }],
          details: {
            isError: true,
            error: errorText,
            tier: 'tier_3',
            blocked: true,
          },
        };
      }

      // 3. Handle Tier 2 (Mutations / Unknown CLI - Blocked in Phase 1 Baseline)
      if (classification.tier === 'tier_2') {
        const errorText = `PermissionRequiredError: Command '${command}' involves mutations (Tier 2). Interactive HITL approval will be enabled in Ticket 022b.`;
        return {
          content: [{ type: 'text', text: errorText }],
          details: {
            isError: true,
            error: errorText,
            tier: 'tier_2',
            blocked: true,
          },
        };
      }

      // 4. Handle Tier 1 (Read-Only Whitelist) -> SafeRunner
      try {
        const runResult = await SafeRunner.run({
          command,
          cwd: params.cwd,
          timeoutMs: params.timeoutMs,
        });

        let outputText = runResult.stdout;
        if (!outputText && runResult.stderr) {
          outputText = runResult.stderr;
        } else if (!outputText && runResult.exitCode === 0) {
          outputText = '(Command completed with no output)';
        }

        return {
          content: [{ type: 'text', text: outputText }],
          details: {
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            exitCode: runResult.exitCode,
            truncated: runResult.truncated,
            logPath: runResult.logPath,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `ExecutionError: ${message}` }],
          details: {
            isError: true,
            error: message,
          },
        };
      }
    },
  };
}

export * from './types.js';
export { CommandClassifier } from './classifier.js';
export { SafeRunner, stripAnsi, applyHeadTailTruncation } from './runner.js';
