import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ExecBashParams, type ExecBashParamsType, CommandRiskTier } from './types.js';
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

      // 2. Handle Tier 3 (Forbidden Blacklist - Hard Defense)
      if (classification.tier === CommandRiskTier.Forbidden) {
        const errorText = `CommandBlockedError: '${command}' matches Tier 3 forbidden blacklists. Escalation or destruction commands are strictly blocked.`;
        return {
          content: [{ type: 'text', text: errorText }],
          details: {
            isError: true,
            error: errorText,
            tier: CommandRiskTier.Forbidden,
            blocked: true,
          },
        };
      }

      // 3. Execute via SafeRunner (Tier 1 read-only & Tier 2 approved commands)
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
