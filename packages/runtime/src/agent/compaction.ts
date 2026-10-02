import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  appendCompactionEntry,
  getEffectiveHistory,
  getLatestCompaction,
  getRoverTurn,
} from '../storage/repositories/history.js';
import type {
  AgentMessage,
  CompactionPayload,
  RoverEntryRecord,
  RoverTurnStatus,
} from '../storage/types.js';

export interface ContextBudgetOptions {
  modelMaxTokens: number;
  systemPromptTokens?: number;
  toolsSchemaTokens?: number;
  memoryInjectionsTokens?: number;
  outputReservedTokens?: number;
  safetyMarginTokens?: number;
}

export interface BudgetAssessment {
  availableBudgetTokens: number;
  currentEffectiveTokens: number;
  isOverBudget: boolean;
  excessTokens: number;
}

/**
 * Fast approximate token estimator for messages and text.
 * Calculates approximate token count considering multi-byte (e.g. CJK) and ASCII characters.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Non-ASCII characters (e.g. CJK) typically use ~0.8-1.2 tokens per character
    if (code > 255) {
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.max(1, Math.ceil(tokens));
}

export function estimateMessageTokens(message: AgentMessage): number {
  let text = '';
  if (typeof message.content === 'string') {
    text += message.content;
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (typeof block === 'object' && block !== null) {
        if ('text' in block && typeof block.text === 'string') {
          text += block.text;
        } else if ('thinking' in block && typeof block.thinking === 'string') {
          text += block.thinking;
        } else if ('arguments' in block) {
          text += JSON.stringify(block.arguments);
        } else if ('content' in block) {
          text += JSON.stringify(block.content);
        }
      }
    }
  }
  // Add base overhead per message (role, headers, tokens)
  return 4 + estimateTextTokens(text);
}

export function assessContextBudget(
  db: Database.Database,
  options: ContextBudgetOptions
): BudgetAssessment {
  const {
    modelMaxTokens,
    systemPromptTokens = 1000,
    toolsSchemaTokens = 1500,
    memoryInjectionsTokens = 500,
    outputReservedTokens = 4000,
    safetyMarginTokens = 1000,
  } = options;

  const overhead =
    systemPromptTokens +
    toolsSchemaTokens +
    memoryInjectionsTokens +
    outputReservedTokens +
    safetyMarginTokens;

  const availableBudgetTokens = Math.max(0, modelMaxTokens - overhead);

  const effective = getEffectiveHistory(db);
  let currentEffectiveTokens = 0;

  if (effective.compaction) {
    currentEffectiveTokens += estimateTextTokens(effective.compaction.data.summary) + 10;
  }

  for (const entry of effective.messages) {
    currentEffectiveTokens += estimateMessageTokens(entry.data);
  }

  const isOverBudget = currentEffectiveTokens > availableBudgetTokens;
  const excessTokens = isOverBudget ? currentEffectiveTokens - availableBudgetTokens : 0;

  return {
    availableBudgetTokens,
    currentEffectiveTokens,
    isOverBudget,
    excessTokens,
  };
}

export interface TurnGroup {
  turnId: string;
  turnStatus: RoverTurnStatus;
  entries: RoverEntryRecord<AgentMessage>[];
  totalTokens: number;
  lastSeq: number;
}

export interface BoundarySelection {
  coveredThroughSeq: number | null;
  turnsToCompact: TurnGroup[];
  turnsToRetain: TurnGroup[];
  estimatedTokensToCompact: number;
}

/**
 * Groups effective messages by Rover Turn, strictly respecting completed boundaries.
 * Running turns are NEVER compacted.
 */
export function selectCompactionBoundary(
  db: Database.Database,
  targetRetainedTokens: number
): BoundarySelection {
  const effective = getEffectiveHistory(db);
  if (effective.messages.length === 0) {
    return {
      coveredThroughSeq: null,
      turnsToCompact: [],
      turnsToRetain: [],
      estimatedTokensToCompact: 0,
    };
  }

  // Group messages by turn_id
  const turnsMap = new Map<string, TurnGroup>();
  for (const entry of effective.messages) {
    if (!entry.turnId) continue;

    let group = turnsMap.get(entry.turnId);
    if (!group) {
      const turnRecord = getRoverTurn(db, entry.turnId);
      const status: RoverTurnStatus = turnRecord ? turnRecord.status : 'completed';
      group = {
        turnId: entry.turnId,
        turnStatus: status,
        entries: [],
        totalTokens: 0,
        lastSeq: entry.seq,
      };
      turnsMap.set(entry.turnId, group);
    }

    group.entries.push(entry);
    group.totalTokens += estimateMessageTokens(entry.data);
    group.lastSeq = Math.max(group.lastSeq, entry.seq);
  }

  const turnGroups = Array.from(turnsMap.values());
  if (turnGroups.length <= 1) {
    // Only 1 turn in history, cannot split prefix
    return {
      coveredThroughSeq: null,
      turnsToCompact: [],
      turnsToRetain: turnGroups,
      estimatedTokensToCompact: 0,
    };
  }

  // Work backwards from the newest turn to retain recent complete turns within targetRetainedTokens
  let retainedTokens = 0;
  const turnsToRetain: TurnGroup[] = [];
  const candidatePrefix: TurnGroup[] = [];

  for (let i = turnGroups.length - 1; i >= 0; i--) {
    const group = turnGroups[i];

    // Invariant: Running turns must always be retained
    if (group.turnStatus === 'running' || turnsToRetain.length === 0) {
      turnsToRetain.unshift(group);
      retainedTokens += group.totalTokens;
      continue;
    }

    if (retainedTokens + group.totalTokens <= targetRetainedTokens) {
      turnsToRetain.unshift(group);
      retainedTokens += group.totalTokens;
    } else {
      // Must compact this turn and all earlier turns
      for (let j = 0; j <= i; j++) {
        // Double check: if an earlier turn is somehow 'running', we cannot compact across it
        if (turnGroups[j].turnStatus === 'running') {
          // Cannot safely compact
          return {
            coveredThroughSeq: null,
            turnsToCompact: [],
            turnsToRetain: turnGroups,
            estimatedTokensToCompact: 0,
          };
        }
        candidatePrefix.push(turnGroups[j]);
      }
      break;
    }
  }

  if (candidatePrefix.length === 0) {
    return {
      coveredThroughSeq: null,
      turnsToCompact: [],
      turnsToRetain,
      estimatedTokensToCompact: 0,
    };
  }

  const lastCompactedTurn = candidatePrefix[candidatePrefix.length - 1];
  const coveredThroughSeq = lastCompactedTurn.lastSeq;
  const estimatedTokensToCompact = candidatePrefix.reduce((acc, t) => acc + t.totalTokens, 0);

  return {
    coveredThroughSeq,
    turnsToCompact: candidatePrefix,
    turnsToRetain,
    estimatedTokensToCompact,
  };
}

export type SummarizerFn = (input: {
  previousSummary: string | null;
  turns: TurnGroup[];
}) => Promise<string>;

export interface CompactionExecutionOptions {
  targetRetainedTokens: number;
  summarizer: SummarizerFn;
  policyVersion?: number;
  provider?: string;
  model?: string;
}

export interface CompactionExecutionResult {
  compacted: boolean;
  compactionEntry?: RoverEntryRecord<CompactionPayload>;
  reason?: string;
}

export class Compactor {
  private inFlight = false;

  get isCompacting(): boolean {
    return this.inFlight;
  }

  async runCompaction(
    db: Database.Database,
    options: CompactionExecutionOptions
  ): Promise<CompactionExecutionResult> {
    if (this.inFlight) {
      return { compacted: false, reason: 'Compaction already in-flight' };
    }

    this.inFlight = true;

    try {
      const initialCompaction = getLatestCompaction(db);
      const previousCompactionId = initialCompaction ? initialCompaction.id : null;
      const previousSummary = initialCompaction ? initialCompaction.data.summary : null;

      const boundary = selectCompactionBoundary(db, options.targetRetainedTokens);
      if (!boundary.coveredThroughSeq || boundary.turnsToCompact.length === 0) {
        return { compacted: false, reason: 'No eligible complete turns for compaction' };
      }

      // Generate the new cumulative summary
      const newSummary = await options.summarizer({
        previousSummary,
        turns: boundary.turnsToCompact,
      });

      if (!newSummary || !newSummary.trim()) {
        throw new Error('Summarizer returned empty summary');
      }

      // Invariant: Verify baseline hasn't changed concurrently before publishing
      const currentLatestCompaction = getLatestCompaction(db);
      const currentLatestId = currentLatestCompaction ? currentLatestCompaction.id : null;

      if (currentLatestId !== previousCompactionId) {
        return {
          compacted: false,
          reason: 'Concurrent compaction detected: baseline changed during generation, discarded',
        };
      }

      const compactionId = crypto.randomUUID();
      const payload: CompactionPayload = {
        summary: newSummary.trim(),
        coveredThroughSeq: boundary.coveredThroughSeq,
        previousCompactionId,
        policyVersion: options.policyVersion ?? 1,
        provider: options.provider,
        model: options.model,
        tokensBefore: boundary.estimatedTokensToCompact,
        tokensAfter: estimateTextTokens(newSummary),
      };

      const entry = appendCompactionEntry(db, {
        id: compactionId,
        compaction: payload,
      });

      return {
        compacted: true,
        compactionEntry: entry,
      };
    } finally {
      this.inFlight = false;
    }
  }
}

export const defaultCompactor = new Compactor();
