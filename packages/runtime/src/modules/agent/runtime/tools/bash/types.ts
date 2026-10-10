import { Type, type Static } from '@earendil-works/pi-ai';

export const ExecBashParams = Type.Object({
  command: Type.String({
    description:
      'The bash/zsh command line to execute (e.g. "gh pr view 123", "curl -s ...", "git status"). Non-interactive commands only.',
  }),
  cwd: Type.Optional(
    Type.String({
      description: 'Absolute path to target working directory. Defaults to active workspace.',
    })
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      description: 'Execution timeout in milliseconds. Default 30000 (30s), max 120000 (2min).',
    })
  ),
});

export type ExecBashParamsType = Static<typeof ExecBashParams>;

export type CommandRiskTier = 'tier_1' | 'tier_2' | 'tier_3';

export interface ClassificationResult {
  tier: CommandRiskTier;
  reason?: string;
}

export interface SafeRunnerOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface SafeRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  logPath?: string;
}
