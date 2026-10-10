import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  createBashTool,
  CommandClassifier,
  CommandRiskTier,
  SafeRunner,
  stripAnsi,
  applyHeadTailTruncation,
} from '../modules/agent/runtime/tools/bash/index.js';

describe('Controlled Bash Tool & SafeRunner Baseline (Ticket 022a & ADR-0022)', () => {
  describe('CommandClassifier', () => {
    it('classifies Tier 1 read-only commands correctly', () => {
      const readOnlyCmds = [
        'git status',
        'git diff HEAD~1',
        'git log -n 5',
        'git branch',
        'git branch -a',
        'gh pr view 123',
        'gh pr list',
        'gh issue view 42',
        'glab mr view 10',
        'curl -I https://example.com',
        'curl -s https://example.com',
        'ls -la',
        'cat package.json',
        'head -n 20 README.md',
        'pwd',
        'which node',
        'echo "Hello Rover"',
      ];

      for (const cmd of readOnlyCmds) {
        const res = CommandClassifier.classify(cmd);
        expect(res.tier, `Expected '${cmd}' to be Tier 1`).toBe(CommandRiskTier.ReadOnly);
      }
    });

    it('classifies pipelines of Tier 1 commands as Tier 1', () => {
      const res = CommandClassifier.classify('git log -n 5 | head -n 2');
      expect(res.tier).toBe(CommandRiskTier.ReadOnly);
    });

    it('correctly treats quotes containing pipe characters without splitting', () => {
      const res = CommandClassifier.classify('git commit -m "feat: use | pipe"');
      expect(res.tier).toBe(CommandRiskTier.Mutation);
      expect(res.reason).toContain('git commit');
    });

    it('classifies Tier 2 mutation and unknown CLI commands correctly', () => {
      const mutationCmds = [
        'git push origin main',
        'git commit -m "feat: update"',
        'git checkout -b feat/new',
        'git branch -D feat/old',
        'gh pr merge 42 --squash',
        'glab mr merge 10',
        'curl -X POST https://api.example.com/deploy',
        'curl -d \'{"name":"test"}\' https://example.com',
        'curl -s https://example.com -o output.json',
        'codemons-cli status',
        'npm run build',
        'echo "data" > file.txt',
        'git status; rm -rf test',
        'git status && git push',
        'echo $(whoami)',
        'echo `id`',
      ];

      for (const cmd of mutationCmds) {
        const res = CommandClassifier.classify(cmd);
        expect(res.tier, `Expected '${cmd}' to be Tier 2`).toBe(CommandRiskTier.Mutation);
      }
    });

    it('classifies Tier 3 destructive and privilege escalation commands correctly', () => {
      const tier3Cmds = [
        'sudo ls',
        'sudo rm -rf /var/log',
        'rm -rf /',
        'rm -rf /*',
        'rm -rf /var/log',
        'mkfs.ext4 /dev/sdb',
        'fdisk /dev/sda',
        ':(){ :|:& };:',
        'git log | sudo rm -rf /',
        'git status | rm -rf /System',
      ];

      for (const cmd of tier3Cmds) {
        const res = CommandClassifier.classify(cmd);
        expect(res.tier, `Expected '${cmd}' to be Tier 3`).toBe(CommandRiskTier.Forbidden);
        expect(res.reason).toContain('matches Tier 3 forbidden blacklists');
      }
    });
  });

  describe('SafeRunner & Output Guard', () => {
    it('strips ANSI escape codes cleanly', () => {
      const colored = '\u001b[31mError:\u001b[0m \u001b[32mSuccess\u001b[0m';
      expect(stripAnsi(colored)).toBe('Error: Success');
    });

    it('applies head/tail truncation when lines exceed limit', () => {
      const manyLines = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}`).join('\n');
      const result = applyHeadTailTruncation(manyLines);

      expect(result.truncated).toBe(true);
      expect(result.logPath).toBeDefined();
      expect(result.text).toContain('Line 1');
      expect(result.text).toContain('Line 250');
      expect(result.text).toContain('Rover Output Guard: 截断 250 行');
      expect(result.text).toContain('Line 600');

      if (result.logPath && fs.existsSync(result.logPath)) {
        fs.unlinkSync(result.logPath);
      }
    });

    it('applies head/tail truncation when bytes exceed 30KB', () => {
      const largeContent = 'A'.repeat(35 * 1024); // 35 KB
      const result = applyHeadTailTruncation(largeContent);

      expect(result.truncated).toBe(true);
      expect(result.logPath).toBeDefined();
      expect(result.text).toContain('Rover Output Guard: 截断');

      if (result.logPath && fs.existsSync(result.logPath)) {
        fs.unlinkSync(result.logPath);
      }
    });

    it('executes a safe command and returns exitCode 0 with stdout', async () => {
      const res = await SafeRunner.run({ command: 'echo "Rover Runner OK"' });
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe('Rover Runner OK');
      expect(res.truncated).toBe(false);
    });

    it('safely terminates process when command times out', async () => {
      const res = await SafeRunner.run({
        command: 'sleep 5',
        timeoutMs: 1000,
      });

      expect(res.exitCode).toBe(124);
      expect(res.stderr).toContain('Command timed out');
    });
  });

  describe('createBashTool execution contract', () => {
    const tool = createBashTool();

    it('has correct tool metadata schema', () => {
      expect(tool.name).toBe('bash');
      expect(tool.label).toBe('Execute Controlled Bash Command');
      expect(tool.parameters).toBeDefined();
    });

    function getText(
      content: (typeof tool.execute extends (...args: any[]) => Promise<infer R>
        ? R
        : any)['content'][number]
    ): string {
      return content && content.type === 'text' ? content.text : '';
    }

    it('rejects empty command', async () => {
      const result = await tool.execute('call_1', { command: '   ' });
      expect(result.details.error).toBe('empty_command');
    });

    it('executes Tier 1 read-only command silently', async () => {
      const result = await tool.execute('call_2', { command: 'echo "Safe Output"' });
      expect(result.content[0].type).toBe('text');
      expect(getText(result.content[0]).trim()).toBe('Safe Output');
      expect(result.details.exitCode).toBe(0);
      expect(result.details.truncated).toBe(false);
    });

    it('hard blocks Tier 3 forbidden commands without starting subprocess', async () => {
      const result = await tool.execute('call_3', { command: 'sudo rm -rf /var/log' });
      expect(result.details.isError).toBe(true);
      expect(result.details.tier).toBe(CommandRiskTier.Forbidden);
      expect(result.details.blocked).toBe(true);
      expect(getText(result.content[0])).toContain('CommandBlockedError');
    });

    it('executes command via SafeRunner and returns output', async () => {
      const result = await tool.execute('call_4', { command: 'node -e "console.log(1+1)"' });
      expect(result.content[0].type).toBe('text');
      expect(getText(result.content[0]).trim()).toBe('2');
      expect(result.details.exitCode).toBe(0);
    });
  });
});
