import path from 'node:path';
import { parse, type ParseEntry } from 'shell-quote';
import type { ClassificationResult, CommandRiskTier } from './types.js';

const TIER_1_READONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'pwd',
  'which',
  'stat',
  'wc',
  'grep',
  'rg',
  'echo',
]);

const GIT_READONLY_SUBCMDS = new Set(['status', 'log', 'diff', 'show', 'rev-parse']);

const GIT_BRANCH_MUTATION_FLAGS = new Set([
  '-d',
  '-D',
  '-m',
  '-M',
  '-c',
  '-C',
  '--delete',
  '--move',
  '--copy',
  '--set-upstream-to',
]);

const CURL_MUTATION_FLAGS = new Set([
  '-d',
  '--data',
  '--data-raw',
  '--data-ascii',
  '--data-binary',
  '--data-urlencode',
  '-F',
  '--form',
  '--form-string',
  '-T',
  '--upload-file',
  '-o',
  '--output',
  '-O',
  '--remote-name',
]);

const CURL_MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function isDestructiveRm(cmd: string): boolean {
  if (!/\brm\b/i.test(cmd)) return false;
  const hasRecursive = /-(?:[a-zA-Z]*r[a-zA-Z]*)/i.test(cmd);
  const hasForce = /-(?:[a-zA-Z]*f[a-zA-Z]*)/i.test(cmd);
  if (hasRecursive || hasForce) {
    if (
      /\s+(\/|\/\*|(?:\/System|\/usr|\/bin|\/sbin|\/etc|\/var|\/private)(?:\s+|$|\/))/i.test(cmd)
    ) {
      return true;
    }
  }
  return false;
}

function checkTier3Raw(command: string): boolean {
  if (/^\s*sudo(?:\s+|$)/i.test(command)) return true;
  if (isDestructiveRm(command)) return true;
  if (/\bmkfs\b/i.test(command)) return true;
  if (/\bfdisk\b/i.test(command)) return true;
  if (/\bdd\b.*of=\/dev\//i.test(command)) return true;
  if (/:\(\)\{:\|:&?\};:/.test(command.replace(/\s+/g, ''))) return true;
  if (/\b(?:shutdown|reboot|poweroff|halt)\b/i.test(command)) return true;
  if (/\bchmod\b\s+-[a-zA-Z]*R[a-zA-Z]*\s+(?:777|0777)\s+(\/|\/\*)/i.test(command)) return true;
  return false;
}

function classifySegmentTokens(tokens: string[]): CommandRiskTier {
  if (tokens.length === 0) {
    return 'tier_2';
  }

  // Check if first token or any token is sudo or destructive command
  if (tokens[0] === 'sudo') {
    return 'tier_3';
  }
  if (tokens[0] === 'rm') {
    const joined = tokens.join(' ');
    if (isDestructiveRm(joined)) {
      return 'tier_3';
    }
  }

  const binary = path.basename(tokens[0]);

  // 1. git
  if (binary === 'git') {
    let i = 1;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === '-C' || t === '--git-dir' || t === '--work-tree') {
        i += 2;
      } else if (t.startsWith('-')) {
        i += 1;
      } else {
        break;
      }
    }
    const subcmd = tokens[i];
    if (subcmd && GIT_READONLY_SUBCMDS.has(subcmd)) {
      return 'tier_1';
    }
    if (subcmd === 'branch') {
      const hasMutation = tokens.slice(i + 1).some((flag) => GIT_BRANCH_MUTATION_FLAGS.has(flag));
      return hasMutation ? 'tier_2' : 'tier_1';
    }
    return 'tier_2';
  }

  // 2. gh
  if (binary === 'gh') {
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    const resource = tokens[i];
    i++;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    const action = tokens[i];

    if (
      (resource === 'pr' || resource === 'issue' || resource === 'run') &&
      (action === 'view' || action === 'list')
    ) {
      return 'tier_1';
    }
    return 'tier_2';
  }

  // 3. glab
  if (binary === 'glab') {
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    const resource = tokens[i];
    i++;
    while (i < tokens.length && tokens[i].startsWith('-')) i++;
    const action = tokens[i];

    if ((resource === 'mr' || resource === 'issue') && (action === 'view' || action === 'list')) {
      return 'tier_1';
    }
    return 'tier_2';
  }

  // 4. curl
  if (binary === 'curl') {
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (CURL_MUTATION_FLAGS.has(t)) {
        return 'tier_2';
      }
      if (t === '-X' || t === '--request') {
        const method = tokens[i + 1]?.toUpperCase();
        if (method && CURL_MUTATION_METHODS.has(method)) {
          return 'tier_2';
        }
      }
      if (t.startsWith('-X')) {
        const method = t.slice(2).toUpperCase();
        if (CURL_MUTATION_METHODS.has(method)) {
          return 'tier_2';
        }
      }
    }
    return 'tier_1';
  }

  // 5. find
  if (binary === 'find') {
    const hasDangerous = tokens
      .slice(1)
      .some((t) => ['-exec', '-execdir', '-delete', '-ok'].includes(t));
    return hasDangerous ? 'tier_2' : 'tier_1';
  }

  // 6. Generic read-only unix commands
  if (TIER_1_READONLY_COMMANDS.has(binary)) {
    return 'tier_1';
  }

  return 'tier_2';
}

export class CommandClassifier {
  public static classify(commandLine: string): ClassificationResult {
    const trimmed = commandLine.trim();
    if (!trimmed) {
      return {
        tier: 'tier_2',
        reason: 'Empty command.',
      };
    }

    // 1. Raw string blacklist check for Tier 3
    if (checkTier3Raw(trimmed)) {
      return {
        tier: 'tier_3',
        reason: `'${trimmed}' matches Tier 3 forbidden blacklists. Escalation or destruction commands are strictly blocked.`,
      };
    }

    // 2. Defend against command substitution ($() or backticks) and dynamic eval in raw string
    if (/\$\(|`|\beval\b|\bexec\b/.test(trimmed)) {
      return {
        tier: 'tier_2',
        reason: `Command contains command substitutions ($() or backticks) or dynamic evaluation.`,
      };
    }

    // 3. Parse tokens and operators via shell-quote
    let entries: ParseEntry[];
    try {
      entries = parse(trimmed, (key) => `$${key}`);
    } catch {
      return {
        tier: 'tier_2',
        reason: `Failed to parse shell command syntax.`,
      };
    }

    if (entries.length === 0) {
      return {
        tier: 'tier_2',
        reason: 'Empty command.',
      };
    }

    // 4. Inspect operators: redirections, chaining, and pipelines
    const pipelineSegments: string[][] = [[]];

    for (const entry of entries) {
      if (typeof entry === 'object' && 'comment' in entry) {
        // Comment, can be ignored in token stream
        continue;
      }

      if (typeof entry === 'object' && 'op' in entry) {
        const op = entry.op;

        // Redirection operators -> Tier 2
        if (['>', '>>', '<', '<(', '>&'].includes(op)) {
          return {
            tier: 'tier_2',
            reason: `Command contains redirection operator '${op}'.`,
          };
        }

        // Chaining operators -> Tier 2
        if ([';', ';;', '&&', '||', '&', '(', ')'].includes(op)) {
          return {
            tier: 'tier_2',
            reason: `Command contains compound chaining or subshell operator '${op}'.`,
          };
        }

        // Pipeline operator -> split into segments
        if (op === '|' || op === '|&') {
          pipelineSegments.push([]);
          continue;
        }

        if (op === 'glob') {
          const currentSeg = pipelineSegments[pipelineSegments.length - 1];
          currentSeg.push(entry.pattern);
          continue;
        }

        return {
          tier: 'tier_2',
          reason: `Command contains unverified operator '${String(op)}'.`,
        };
      }

      if (typeof entry === 'string') {
        const currentSeg = pipelineSegments[pipelineSegments.length - 1];
        currentSeg.push(entry);
      }
    }

    // 5. Evaluate all pipeline segments
    for (const segment of pipelineSegments) {
      if (segment.length === 0) {
        return {
          tier: 'tier_2',
          reason: 'Empty pipeline segment.',
        };
      }

      const tier = classifySegmentTokens(segment);
      if (tier === 'tier_3') {
        const segCmd = segment.join(' ');
        return {
          tier: 'tier_3',
          reason: `'${segCmd}' matches Tier 3 forbidden blacklists. Escalation or destruction commands are strictly blocked.`,
        };
      }

      if (tier !== 'tier_1') {
        const segCmd = segment.join(' ');
        return {
          tier: 'tier_2',
          reason: `Command or segment '${segCmd}' involves mutations or unverified tools (Tier 2).`,
        };
      }
    }

    return { tier: 'tier_1' };
  }
}
