/**
 * Observer Constants.
 *
 * Defines hook event lists, markers, and non-enum constants for observer adapters.
 */

import type { ClaudeHookEvent, CodexHookEvent } from '../types.js';

export const ROVER_HOOK_MARKER = 'rover-hook-helper';

export const CLAUDE_HOOK_EVENTS: readonly ClaudeHookEvent[] = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'StopFailure',
] as const;

export const CODEX_HOOK_EVENTS: readonly CodexHookEvent[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const;
