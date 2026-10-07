import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  installClaudeHooks,
  uninstallClaudeHooks,
  installCodexHooks,
  uninstallCodexHooks,
  installOpenCodePlugin,
  uninstallOpenCodePlugin,
  checkHooksHealth,
  HookManager,
  ClaudeHookAdapter,
  CodexHookAdapter,
  OpenCodeHookAdapter,
  defaultHookManager,
  CLAUDE_HOOK_EVENTS,
  CODEX_HOOK_EVENTS,
  ROVER_HOOK_MARKER,
  type HookConfigFile,
} from '../index.js';

describe('Hook Configuration & Helper Pipeline (M1-3)', () => {
  let tempDir: string;
  let claudeSettingsPath: string;
  let codexHooksPath: string;
  let opencodeConfigPath: string;
  let mockHelperPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-hook-test-'));
    claudeSettingsPath = path.join(tempDir, 'claude-settings.json');
    codexHooksPath = path.join(tempDir, 'codex-hooks.json');
    opencodeConfigPath = path.join(tempDir, 'opencode.json');
    mockHelperPath = path.join(tempDir, 'mock-rover-hook-helper');
    fs.writeFileSync(mockHelperPath, '#!/bin/sh\nexit 0', { mode: 0o755 });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Claude Code Hooks Lifecycle', () => {
    it('installs hooks into clean configuration and backs up file', () => {
      // Seed existing config with an existing third-party hook
      const initialConfig: HookConfigFile = {
        model: 'sonnet',
        hooks: {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: '/path/to/orca-hook.sh' }],
            },
          ],
        },
      };
      fs.writeFileSync(claudeSettingsPath, JSON.stringify(initialConfig, null, 2));

      installClaudeHooks(claudeSettingsPath, mockHelperPath);

      // Verify backup created
      expect(fs.existsSync(`${claudeSettingsPath}.rover.bak`)).toBe(true);

      const updated = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8')) as HookConfigFile;
      expect(updated.model).toBe('sonnet');
      expect(updated.hooks).toBeDefined();

      // Check all expected Claude events are covered
      for (const event of CLAUDE_HOOK_EVENTS) {
        expect(updated.hooks![event]).toBeDefined();
        const hasRover = updated.hooks![event].some((group) =>
          group.hooks.some((h) => h.command.includes(ROVER_HOOK_MARKER))
        );
        expect(hasRover).toBe(true);
      }

      // Ensure existing third-party hook was NOT destroyed
      const preToolGroups = updated.hooks!.PreToolUse;
      expect(
        preToolGroups.some((g) => g.hooks.some((h) => h.command.includes('orca-hook.sh')))
      ).toBe(true);
    });

    it('is idempotent on duplicate install calls', () => {
      installClaudeHooks(claudeSettingsPath, mockHelperPath);
      installClaudeHooks(claudeSettingsPath, mockHelperPath);

      const config = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8')) as HookConfigFile;
      for (const event of CLAUDE_HOOK_EVENTS) {
        const roverGroups = config.hooks![event].filter((group) =>
          group.hooks.some((h) => h.command.includes(ROVER_HOOK_MARKER))
        );
        expect(roverGroups.length).toBe(1);
      }
    });

    it('uninstalls cleanly, leaving third-party hooks untouched', () => {
      const initialConfig: HookConfigFile = {
        hooks: {
          PreToolUse: [
            {
              hooks: [{ type: 'command', command: '/custom/user-hook.sh' }],
            },
          ],
        },
      };
      fs.writeFileSync(claudeSettingsPath, JSON.stringify(initialConfig, null, 2));

      installClaudeHooks(claudeSettingsPath, mockHelperPath);
      uninstallClaudeHooks(claudeSettingsPath);

      const cleaned = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8')) as HookConfigFile;
      // PreToolUse should still have the user hook
      expect(cleaned.hooks?.PreToolUse.length).toBe(1);
      expect(cleaned.hooks?.PreToolUse[0].hooks[0].command).toBe('/custom/user-hook.sh');

      // Other events that only had Rover hooks should be cleanly removed
      expect(cleaned.hooks?.Stop).toBeUndefined();
      expect(cleaned.hooks?.SessionStart).toBeUndefined();
    });
  });

  describe('Codex Hooks Lifecycle', () => {
    it('installs hooks into codex hooks.json and preserves existing hooks', () => {
      const initialConfig: HookConfigFile = {
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: '/custom/clawd-hook.sh' }],
            },
          ],
        },
      };
      fs.writeFileSync(codexHooksPath, JSON.stringify(initialConfig, null, 2));

      installCodexHooks(codexHooksPath, mockHelperPath);

      expect(fs.existsSync(`${codexHooksPath}.rover.bak`)).toBe(true);

      const updated = JSON.parse(fs.readFileSync(codexHooksPath, 'utf-8')) as HookConfigFile;
      for (const event of CODEX_HOOK_EVENTS) {
        expect(updated.hooks![event]).toBeDefined();
        const hasRover = updated.hooks![event].some((group) =>
          group.hooks.some((h) => h.command.includes(ROVER_HOOK_MARKER))
        );
        expect(hasRover).toBe(true);
      }

      // Preserves clawd hook
      expect(
        updated.hooks!.SessionStart.some((g) =>
          g.hooks.some((h) => h.command.includes('clawd-hook.sh'))
        )
      ).toBe(true);
    });

    it('uninstalls codex hooks cleanly', () => {
      installCodexHooks(codexHooksPath, mockHelperPath);
      uninstallCodexHooks(codexHooksPath);

      const config = JSON.parse(fs.readFileSync(codexHooksPath, 'utf-8')) as HookConfigFile;
      for (const event of CODEX_HOOK_EVENTS) {
        expect(config.hooks?.[event]).toBeUndefined();
      }
    });
  });

  describe('OpenCode Plugin Lifecycle', () => {
    it('installs and uninstalls opencode plugin cleanly', () => {
      fs.writeFileSync(opencodeConfigPath, JSON.stringify({ plugin: ['/other/plugin'] }, null, 2));

      installOpenCodePlugin(opencodeConfigPath, '/path/to/rover/plugin');
      const updated = JSON.parse(fs.readFileSync(opencodeConfigPath, 'utf-8'));
      expect(updated.plugin).toContain('/other/plugin');
      expect(updated.plugin).toContain('/path/to/rover/plugin');

      // Idempotent
      installOpenCodePlugin(opencodeConfigPath, '/path/to/rover/plugin');
      const twice = JSON.parse(fs.readFileSync(opencodeConfigPath, 'utf-8'));
      expect(twice.plugin.length).toBe(2);

      uninstallOpenCodePlugin(opencodeConfigPath, 'rover');
      const cleaned = JSON.parse(fs.readFileSync(opencodeConfigPath, 'utf-8'));
      expect(cleaned.plugin).toEqual(['/other/plugin']);
    });
  });

  describe('Health Audit', () => {
    it('reports accurate health for missing, partial, and full installations', () => {
      const initialHealth = checkHooksHealth({
        claudePath: claudeSettingsPath,
        codexPath: codexHooksPath,
        opencodePath: opencodeConfigPath,
        helperPath: mockHelperPath,
      });

      expect(initialHealth.helperBinary.exists).toBe(true);
      expect(initialHealth.claude.installed).toBe(false);
      expect(initialHealth.claude.healthy).toBe(false);
      expect(initialHealth.claude.missingEvents).toEqual([...CLAUDE_HOOK_EVENTS]);

      installClaudeHooks(claudeSettingsPath, mockHelperPath);
      installCodexHooks(codexHooksPath, mockHelperPath);

      const fullHealth = checkHooksHealth({
        claudePath: claudeSettingsPath,
        codexPath: codexHooksPath,
        opencodePath: opencodeConfigPath,
        helperPath: mockHelperPath,
      });

      expect(fullHealth.claude.installed).toBe(true);
      expect(fullHealth.claude.healthy).toBe(true);
      expect(fullHealth.claude.missingEvents).toHaveLength(0);
      expect(fullHealth.codex.installed).toBe(true);
      expect(fullHealth.codex.healthy).toBe(true);
      expect(fullHealth.codex.missingEvents).toHaveLength(0);
    });
  });

  describe('Rust rover-hook-helper Native Binary Execution', () => {
    const helperBinaryPath = path.resolve(
      __dirname,
      '../../../app/src-tauri/target/debug/rover-hook-helper'
    );

    it.skipIf(!fs.existsSync(helperBinaryPath))(
      'exits with 0 and zero disk writes when ROVER_DISPATCH_ATTEMPT_ID is absent (zero pollution)',
      () => {
        const spoolDir = path.join(tempDir, 'spool');
        const result = execFileSync(helperBinaryPath, ['PreToolUse'], {
          input: '{"dummy":"data"}',
          env: {
            ...process.env,
            ROVER_DISPATCH_ATTEMPT_ID: '', // empty / absent
            ROVER_SPOOL_DIR: spoolDir,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        expect(result.length).toBe(0);
        expect(fs.existsSync(spoolDir)).toBe(false);
      }
    );

    it.skipIf(!fs.existsSync(helperBinaryPath))(
      'atomically writes envelope to spool when ROVER_DISPATCH_ATTEMPT_ID is set',
      () => {
        const spoolDir = path.join(tempDir, 'spool');
        const inputJson = JSON.stringify({
          tool: 'bash',
          command: 'npm test',
        });

        execFileSync(helperBinaryPath, ['PreToolUse'], {
          input: inputJson,
          env: {
            ...process.env,
            ROVER_DISPATCH_ATTEMPT_ID: 'att_integration_test',
            ROVER_SPOOL_DIR: spoolDir,
            ROVER_AGENT_TYPE: 'claude',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        expect(fs.existsSync(spoolDir)).toBe(true);
        const files = fs.readdirSync(spoolDir).filter((f) => f.endsWith('.json'));
        expect(files.length).toBe(1);

        const content = JSON.parse(fs.readFileSync(path.join(spoolDir, files[0]), 'utf-8'));
        expect(content.attemptId).toBe('att_integration_test');
        expect(content.event).toBe('PreToolUse');
        expect(content.agentType).toBe('claude');
        expect(content.payload.tool).toBe('bash');
      }
    );

    it.skipIf(!fs.existsSync(helperBinaryPath))(
      'records explicit report with capability token into spool',
      () => {
        const spoolDir = path.join(tempDir, 'spool');

        const stdout = execFileSync(
          helperBinaryPath,
          [
            'report',
            '--attempt-id',
            'att_report_test',
            '--token',
            'tok_valid_capability',
            '--status',
            'completed',
            '--result',
            'Test passed successfully',
            '--summary',
            'All 10 tests passed',
          ],
          {
            env: {
              ...process.env,
              ROVER_SPOOL_DIR: spoolDir,
            },
            encoding: 'utf-8',
          }
        );

        expect(stdout).toContain('"ok":true');

        const files = fs.readdirSync(spoolDir).filter((f) => f.endsWith('.json'));
        expect(files.length).toBe(1);

        const content = JSON.parse(fs.readFileSync(path.join(spoolDir, files[0]), 'utf-8'));
        expect(content.attemptId).toBe('att_report_test');
        expect(content.token).toBe('tok_valid_capability');
        expect(content.event).toBe('Report');
        expect(content.status).toBe('completed');
        expect(content.result).toBe('Test passed successfully');
      }
    );
  });

  describe('HookManager & AgentHookAdapter Architecture', () => {
    it('manages adapters for claude, codex, and opencode mirroring dispatch AgentRegistry', () => {
      const manager = new HookManager();
      expect(manager.listRegisteredAgents()).toEqual(['claude', 'codex', 'opencode']);
      expect(manager.has('claude')).toBe(true);
      expect(manager.has('codex')).toBe(true);
      expect(manager.has('opencode')).toBe(true);

      expect(manager.get('claude')).toBeInstanceOf(ClaudeHookAdapter);
      expect(manager.get('codex')).toBeInstanceOf(CodexHookAdapter);
      expect(manager.get('opencode')).toBeInstanceOf(OpenCodeHookAdapter);

      expect(() => manager.get('unsupported' as any)).toThrow(/Unsupported hook adapter/);
    });

    it('installs and uninstalls via manager with custom options', () => {
      const manager = new HookManager();
      manager.install('claude', {
        configPath: claudeSettingsPath,
        helperPath: mockHelperPath,
      });

      const claudeHealth = manager.checkHealth('claude', {
        configPath: claudeSettingsPath,
        helperPath: mockHelperPath,
      });
      expect(claudeHealth.healthy).toBe(true);

      manager.uninstall('claude', { configPath: claudeSettingsPath });
      const afterUninstall = manager.checkHealth('claude', {
        configPath: claudeSettingsPath,
        helperPath: mockHelperPath,
      });
      expect(afterUninstall.installed).toBe(false);
    });

    it('installAll and uninstallAll coordinate across all adapters', () => {
      defaultHookManager.installAll({
        claudePath: claudeSettingsPath,
        codexPath: codexHooksPath,
        opencodePath: opencodeConfigPath,
        helperPath: mockHelperPath,
      });

      const allHealth = defaultHookManager.checkAllHealth({
        claudePath: claudeSettingsPath,
        codexPath: codexHooksPath,
        opencodePath: opencodeConfigPath,
        helperPath: mockHelperPath,
      });
      expect(allHealth.claude.healthy).toBe(true);
      expect(allHealth.codex.healthy).toBe(true);
      expect(allHealth.opencode.healthy).toBe(true);

      defaultHookManager.uninstallAll({
        claudePath: claudeSettingsPath,
        codexPath: codexHooksPath,
        opencodePath: opencodeConfigPath,
      });

      const afterClean = defaultHookManager.checkAllHealth({
        claudePath: claudeSettingsPath,
        codexPath: codexHooksPath,
        opencodePath: opencodeConfigPath,
        helperPath: mockHelperPath,
      });
      expect(afterClean.claude.installed).toBe(false);
      expect(afterClean.codex.installed).toBe(false);
      expect(afterClean.opencode.installed).toBe(false);
    });
  });
});
