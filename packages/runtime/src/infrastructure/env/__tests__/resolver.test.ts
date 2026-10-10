import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  UserEnvResolver,
  parseEnvOutput,
  mergePaths,
  getDefaultMacFallbackPaths,
  SENTINEL_START,
  SENTINEL_END,
  SANITIZED_ENV_OVERRIDES,
} from '../index.js';

describe('UserEnvResolver (Ticket 022a & ADR-0021)', () => {
  beforeEach(() => {
    UserEnvResolver.resetCache();
  });

  afterEach(() => {
    UserEnvResolver.resetCache();
    vi.restoreAllMocks();
  });

  describe('parseEnvOutput', () => {
    it('correctly parses environment variables between sentinel tokens', () => {
      const output = [
        'Welcome to Zsh!',
        'Some noise before sentinel',
        SENTINEL_START,
        'PATH=/opt/homebrew/bin:/usr/bin',
        'GITHUB_TOKEN=ghp_secret123',
        'EMPTY_VAL=',
        'INVALID_LINE_NO_EQUALS',
        SENTINEL_END,
        'Some noise after sentinel',
      ].join('\n');

      const parsed = parseEnvOutput(output);
      expect(parsed.PATH).toBe('/opt/homebrew/bin:/usr/bin');
      expect(parsed.GITHUB_TOKEN).toBe('ghp_secret123');
      expect(parsed.EMPTY_VAL).toBe('');
      expect(parsed.INVALID_LINE_NO_EQUALS).toBeUndefined();
    });

    it('returns empty object if sentinels are missing', () => {
      const output = 'PATH=/usr/bin\nUSER=test';
      expect(parseEnvOutput(output)).toEqual({});
    });
  });

  describe('mergePaths', () => {
    it('preserves existing paths and appends non-duplicate fallback paths', () => {
      const existing = '/usr/local/bin:/usr/bin';
      const fallbacks = ['/opt/homebrew/bin', '/usr/bin', '/bin'];
      const merged = mergePaths(existing, fallbacks);

      const parts = merged.split(path.delimiter);
      expect(parts).toEqual(['/usr/local/bin', '/usr/bin', '/opt/homebrew/bin', '/bin']);
    });

    it('handles empty or undefined existing path', () => {
      const fallbacks = ['/opt/homebrew/bin', '/usr/bin'];
      const merged = mergePaths(undefined, fallbacks);
      expect(merged.split(path.delimiter)).toEqual(fallbacks);
    });
  });

  describe('getDefaultMacFallbackPaths', () => {
    it('includes standard homebrew and local bin paths with user home', () => {
      const paths = getDefaultMacFallbackPaths('/mock/home');
      expect(paths).toContain('/opt/homebrew/bin');
      expect(paths).toContain('/usr/local/bin');
      expect(paths).toContain('/bin');
      expect(paths).toContain('/mock/home/.local/bin');
      expect(paths).toContain('/mock/home/.cargo/bin');
    });
  });

  describe('resolve', () => {
    it('resolves environment and always enforces non-interactive overrides', async () => {
      const resolved = await UserEnvResolver.resolve();

      expect(resolved.CI).toBe(SANITIZED_ENV_OVERRIDES.CI);
      expect(resolved.TERM).toBe(SANITIZED_ENV_OVERRIDES.TERM);
      expect(resolved.DEBIAN_FRONTEND).toBe(SANITIZED_ENV_OVERRIDES.DEBIAN_FRONTEND);
      expect(resolved.PAGER).toBe(SANITIZED_ENV_OVERRIDES.PAGER);
      expect(resolved.GIT_PAGER).toBe(SANITIZED_ENV_OVERRIDES.GIT_PAGER);
      expect(typeof resolved.PATH).toBe('string');
      expect(resolved.PATH.length).toBeGreaterThan(0);
    });

    it('caches the resolved environment across multiple calls', async () => {
      const first = await UserEnvResolver.resolve();
      const second = await UserEnvResolver.resolve();

      expect(first).toBe(second);
      expect(UserEnvResolver.getCached()).toBe(first);
    });

    it('supports forceRefresh to re-resolve environment', async () => {
      await UserEnvResolver.resolve();
      const refreshed = await UserEnvResolver.resolve({ forceRefresh: true });

      expect(refreshed).toBeDefined();
      expect(refreshed.CI).toBe('1');
    });
  });
});
