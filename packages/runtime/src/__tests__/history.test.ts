import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  runMigrations,
  createRoverTurn,
  updateRoverTurnStatus,
  appendMessageEntry,
  appendCompactionEntry,
  getEffectiveHistory,
  getLatestCompaction,
  getTurnEntries,
  getEntryById,
  listEntries,
  getHistoryStats,
  listRoverTurns,
  type RoverDatabase,
  type AgentMessage,
} from '../storage/index.js';
import {
  assessContextBudget,
  selectCompactionBoundary,
  estimateTextTokens,
  estimateMessageTokens,
  Compactor,
  type TurnGroup,
} from '../agent/compaction.js';

describe('Global History & Compaction Storage (Ticket 004)', () => {
  let db: RoverDatabase;

  beforeEach(() => {
    db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('1. Message Persistence & Idempotency', () => {
    it('saves raw message entries and preserves tool call chains across turns in seq order', () => {
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: '派发 Codex 修复' } });

      const userMsg: AgentMessage = { role: 'user', content: '派发 Codex 修复' };
      const toolCallMsg: AgentMessage = {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: { agent: 'codex', goal: 'Fix bug' },
          },
        ],
      };
      const toolResultMsg: AgentMessage = {
        role: 'toolResult',
        content: [{ type: 'toolResult', toolCallId: 'call_1', content: { taskId: 'task_123' } }],
      };
      const finalMsg: AgentMessage = {
        role: 'assistant',
        content: '已成功派发任务 task_123',
      };

      const e1 = appendMessageEntry(db.raw, { id: 'm1', turnId: 'turn_1', message: userMsg });
      const e2 = appendMessageEntry(db.raw, { id: 'm2', turnId: 'turn_1', message: toolCallMsg });
      const e3 = appendMessageEntry(db.raw, { id: 'm3', turnId: 'turn_1', message: toolResultMsg });
      const e4 = appendMessageEntry(db.raw, { id: 'm4', turnId: 'turn_1', message: finalMsg });

      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(2);
      expect(e3.seq).toBe(3);
      expect(e4.seq).toBe(4);

      const turnMessages = getTurnEntries(db.raw, 'turn_1');
      expect(turnMessages).toHaveLength(4);
      expect(turnMessages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
      expect(turnMessages[1].data.role).toBe('assistant');
      expect(turnMessages[2].data.role).toBe('toolResult');
    });

    it('deduplicates identical message ID retries and strictly rejects conflicting data', () => {
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: 'hello' } });

      const msg: AgentMessage = { role: 'user', content: 'hello' };
      const first = appendMessageEntry(db.raw, { id: 'm_same', turnId: 'turn_1', message: msg });

      // Retry with same content succeeds idempotently
      const retry = appendMessageEntry(db.raw, { id: 'm_same', turnId: 'turn_1', message: msg });
      expect(retry.seq).toBe(first.seq);

      // Retry with different content throws conflict error
      const conflictingMsg: AgentMessage = { role: 'user', content: 'different' };
      expect(() => {
        appendMessageEntry(db.raw, { id: 'm_same', turnId: 'turn_1', message: conflictingMsg });
      }).toThrow(/already exists with conflicting data/);
    });
  });

  describe('2. Effective History Reconstruction', () => {
    it('returns raw messages when no compaction exists', () => {
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: 't1' } });
      appendMessageEntry(db.raw, {
        id: 'm1',
        turnId: 'turn_1',
        message: { role: 'user', content: 'msg1' },
      });
      appendMessageEntry(db.raw, {
        id: 'm2',
        turnId: 'turn_1',
        message: { role: 'assistant', content: 'msg2' },
      });

      const effective = getEffectiveHistory(db.raw);
      expect(effective.compaction).toBeNull();
      expect(effective.messages).toHaveLength(2);
      expect(effective.messages.map((m) => m.seq)).toEqual([1, 2]);
    });

    it('returns cumulative summary plus suffix messages strictly after coveredThroughSeq', () => {
      // Turn 1
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: 't1' } });
      appendMessageEntry(db.raw, {
        id: 'm1',
        turnId: 'turn_1',
        message: { role: 'user', content: 'q1' },
      }); // seq 1
      appendMessageEntry(db.raw, {
        id: 'm2',
        turnId: 'turn_1',
        message: { role: 'assistant', content: 'a1' },
      }); // seq 2
      updateRoverTurnStatus(db.raw, { id: 'turn_1', status: 'completed' });

      // Turn 2
      createRoverTurn(db.raw, { id: 'turn_2', promptDoc: { text: 't2' } });
      appendMessageEntry(db.raw, {
        id: 'm3',
        turnId: 'turn_2',
        message: { role: 'user', content: 'q2' },
      }); // seq 3
      appendMessageEntry(db.raw, {
        id: 'm4',
        turnId: 'turn_2',
        message: { role: 'assistant', content: 'a2' },
      }); // seq 4
      updateRoverTurnStatus(db.raw, { id: 'turn_2', status: 'completed' });

      // Turn 3
      createRoverTurn(db.raw, { id: 'turn_3', promptDoc: { text: 't3' } });
      appendMessageEntry(db.raw, {
        id: 'm5',
        turnId: 'turn_3',
        message: { role: 'user', content: 'q3' },
      }); // seq 5
      appendMessageEntry(db.raw, {
        id: 'm6',
        turnId: 'turn_3',
        message: { role: 'assistant', content: 'a3' },
      }); // seq 6

      // Compact Turn 1 (coveredThroughSeq = 2)
      appendCompactionEntry(db.raw, {
        id: 'c1',
        compaction: {
          summary: 'Summary of Turn 1 (q1 -> a1)',
          coveredThroughSeq: 2,
          previousCompactionId: null,
          policyVersion: 1,
        },
      }); // seq 7

      const effective = getEffectiveHistory(db.raw);
      expect(effective.compaction).not.toBeNull();
      expect(effective.compaction?.data.summary).toBe('Summary of Turn 1 (q1 -> a1)');
      // Effective history should be: C1 summary + messages after seq 2 (i.e. seq 3, 4, 5, 6)
      expect(effective.messages.map((m) => m.seq)).toEqual([3, 4, 5, 6]);

      // Note: original messages 1 & 2 are still queryable by ID or turn
      expect(getEntryById(db.raw, 'm1')).not.toBeNull();
      expect(getTurnEntries(db.raw, 'turn_1')).toHaveLength(2);
    });

    it('incorporates messages added during/after compaction without loss', () => {
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: 't1' } });
      appendMessageEntry(db.raw, {
        id: 'm1',
        turnId: 'turn_1',
        message: { role: 'user', content: '1' },
      });
      updateRoverTurnStatus(db.raw, { id: 'turn_1', status: 'completed' });

      createRoverTurn(db.raw, { id: 'turn_2', promptDoc: { text: 't2' } });
      appendMessageEntry(db.raw, {
        id: 'm2',
        turnId: 'turn_2',
        message: { role: 'user', content: '2' },
      });

      // Background compaction completes for Turn 1
      appendCompactionEntry(db.raw, {
        id: 'c1',
        compaction: {
          summary: 'Summary 1',
          coveredThroughSeq: 1,
          previousCompactionId: null,
          policyVersion: 1,
        },
      });

      // New message arrives after compaction was published
      appendMessageEntry(db.raw, {
        id: 'm3',
        turnId: 'turn_2',
        message: { role: 'assistant', content: '3' },
      });

      const effective = getEffectiveHistory(db.raw);
      expect(effective.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
    });
  });

  describe('3. Compaction Engine & Boundary Rules', () => {
    it('assesses context budget accurately based on effective tokens', () => {
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: 't1' } });
      appendMessageEntry(db.raw, {
        id: 'm1',
        turnId: 'turn_1',
        message: { role: 'user', content: 'A short message' },
      });

      const assessment = assessContextBudget(db.raw, {
        modelMaxTokens: 8000,
        systemPromptTokens: 1000,
        toolsSchemaTokens: 1000,
        memoryInjectionsTokens: 0,
        outputReservedTokens: 2000,
        safetyMarginTokens: 500,
      });

      expect(assessment.availableBudgetTokens).toBe(3500);
      expect(assessment.isOverBudget).toBe(false);
      expect(assessment.currentEffectiveTokens).toBeGreaterThan(0);
    });

    it('uses exact BPE tokens for text and prioritizes authoritative provider usage', () => {
      // 1. Text BPE estimation
      const textTokens = estimateTextTokens('Hello, world!');
      expect(textTokens).toBeGreaterThan(0);

      // 2. Message with authoritative usage from provider
      const msgWithUsage: AgentMessage = {
        role: 'assistant',
        content: 'some long content that would estimate to more tokens',
        usage: { totalTokens: 42 },
      };
      expect(estimateMessageTokens(msgWithUsage)).toBe(42);

      // 3. Message without usage falls back to base overhead + BPE
      const msgWithoutUsage: AgentMessage = {
        role: 'user',
        content: 'Hello, world!',
      };
      expect(estimateMessageTokens(msgWithoutUsage)).toBe(4 + textTokens);
    });

    it('never compacts running turns, only completed turns', () => {
      // Turn 1: completed
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: 't1' } });
      appendMessageEntry(db.raw, {
        id: 'm1',
        turnId: 'turn_1',
        message: { role: 'user', content: 'q1' },
      });
      appendMessageEntry(db.raw, {
        id: 'm2',
        turnId: 'turn_1',
        message: { role: 'assistant', content: 'a1' },
      });
      updateRoverTurnStatus(db.raw, { id: 'turn_1', status: 'completed' });

      // Turn 2: still running!
      createRoverTurn(db.raw, { id: 'turn_2', promptDoc: { text: 't2' } });
      appendMessageEntry(db.raw, {
        id: 'm3',
        turnId: 'turn_2',
        message: { role: 'user', content: 'q2' },
      });

      // Boundary selection with small target budget to force compaction
      const selection = selectCompactionBoundary(db.raw, 1);
      expect(selection.coveredThroughSeq).toBe(2);
      expect(selection.turnsToCompact).toHaveLength(1);
      expect(selection.turnsToCompact[0].turnId).toBe('turn_1');
      expect(selection.turnsToRetain).toHaveLength(1);
      expect(selection.turnsToRetain[0].turnId).toBe('turn_2');
    });

    it('executes full compaction with custom summarizer and updates cumulative history', async () => {
      const compactor = new Compactor();

      // Create 3 completed turns
      for (let i = 1; i <= 3; i++) {
        const tid = `turn_${i}`;
        createRoverTurn(db.raw, { id: tid, promptDoc: { text: `Goal ${i}` } });
        appendMessageEntry(db.raw, {
          id: `m_${i}_u`,
          turnId: tid,
          message: { role: 'user', content: `User instruction ${i} for task ref #123` },
        });
        appendMessageEntry(db.raw, {
          id: `m_${i}_a`,
          turnId: tid,
          message: { role: 'assistant', content: `Assistant finished step ${i}` },
        });
        updateRoverTurnStatus(db.raw, { id: tid, status: 'completed' });
      }

      // Compact keeping only the last turn
      const result = await compactor.runCompaction(db.raw, {
        targetRetainedTokens: 20,
        summarizer: async ({
          previousSummary,
          turns,
        }: {
          previousSummary: string | null;
          turns: TurnGroup[];
        }) => {
          return `Cumulative Summary: Covered ${turns.length} turns including task ref #123. Previous: ${previousSummary ?? 'none'}`;
        },
      });

      expect(result.compacted).toBe(true);
      expect(result.compactionEntry).toBeDefined();

      const latestComp = getLatestCompaction(db.raw);
      expect(latestComp?.data.summary).toContain('Covered 2 turns including task ref #123');

      const effective = getEffectiveHistory(db.raw);
      expect(effective.compaction?.id).toBe(latestComp?.id);
      // Turn 3 should be retained as suffix
      expect(effective.messages.every((m) => m.turnId === 'turn_3')).toBe(true);
    });

    it('rejects publication if baseline changed concurrently during generation', async () => {
      const compactor = new Compactor();

      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: '1' } });
      appendMessageEntry(db.raw, {
        id: 'm1',
        turnId: 'turn_1',
        message: { role: 'user', content: '1' },
      });
      updateRoverTurnStatus(db.raw, { id: 'turn_1', status: 'completed' });

      createRoverTurn(db.raw, { id: 'turn_2', promptDoc: { text: '2' } });
      appendMessageEntry(db.raw, {
        id: 'm2',
        turnId: 'turn_2',
        message: { role: 'user', content: '2' },
      });
      updateRoverTurnStatus(db.raw, { id: 'turn_2', status: 'completed' });

      // Run compaction with a summarizer that simulates concurrent compaction injection
      const result = await compactor.runCompaction(db.raw, {
        targetRetainedTokens: 1,
        summarizer: async () => {
          // Simulate concurrent compaction published while we were generating
          appendCompactionEntry(db.raw, {
            id: 'concurrent_c',
            compaction: {
              summary: 'Concurrent Summary',
              coveredThroughSeq: 1,
              previousCompactionId: null,
              policyVersion: 1,
            },
          });
          return 'Stale Summary';
        },
      });

      expect(result.compacted).toBe(false);
      expect(result.reason).toContain('Concurrent compaction detected');

      // Verify stale summary was not stored
      const latest = getLatestCompaction(db.raw);
      expect(latest?.id).toBe('concurrent_c');
    });

    it('enforces coveredThroughSeq must be strictly greater on successive compactions', () => {
      createRoverTurn(db.raw, { id: 'turn_1', promptDoc: { text: '1' } });
      appendMessageEntry(db.raw, {
        id: 'm1',
        turnId: 'turn_1',
        message: { role: 'user', content: '1' },
      }); // seq 1
      appendMessageEntry(db.raw, {
        id: 'm2',
        turnId: 'turn_1',
        message: { role: 'assistant', content: '2' },
      }); // seq 2

      appendCompactionEntry(db.raw, {
        id: 'c1',
        compaction: {
          summary: 'C1',
          coveredThroughSeq: 2,
          previousCompactionId: null,
          policyVersion: 1,
        },
      });

      // Attempting second compaction covering seq 2 (same as previous) must throw
      expect(() => {
        appendCompactionEntry(db.raw, {
          id: 'c2_invalid',
          compaction: {
            summary: 'C2',
            coveredThroughSeq: 2,
            previousCompactionId: 'c1',
            policyVersion: 1,
          },
        });
      }).toThrow(/must be strictly greater than previous/);
    });
  });

  describe('4. History Feed & Dashboard Querying', () => {
    it('supports paginated listEntries, filtering by turn and type, and history statistics', () => {
      // 1. Create turns and entries
      createRoverTurn(db.raw, { id: 'turn_a', promptDoc: { text: 'Prompt A' } });
      appendMessageEntry(db.raw, {
        id: 'msg_a1',
        turnId: 'turn_a',
        message: { role: 'user', content: 'Prompt A' },
      });
      appendMessageEntry(db.raw, {
        id: 'msg_a2',
        turnId: 'turn_a',
        message: { role: 'assistant', content: 'Response A' },
      });

      createRoverTurn(db.raw, { id: 'turn_b', promptDoc: { text: 'Prompt B' } });
      appendMessageEntry(db.raw, {
        id: 'msg_b1',
        turnId: 'turn_b',
        message: { role: 'user', content: 'Prompt B' },
      });
      appendCompactionEntry(db.raw, {
        id: 'cmp_1',
        compaction: {
          summary: 'Summary of Turn A and B',
          coveredThroughSeq: 2,
          previousCompactionId: null,
          tokensBefore: 500,
          tokensAfter: 100,
          policyVersion: 1,
        },
      });

      // 2. Test listEntries with default pagination
      const allEntries = listEntries(db.raw);
      expect(allEntries).toHaveLength(4);
      expect(allEntries[0].id).toBe('msg_a1');
      expect(allEntries[3].id).toBe('cmp_1');

      // 3. Test filtering by turnId
      const turnAEntries = listEntries(db.raw, { turnId: 'turn_a' });
      expect(turnAEntries).toHaveLength(2);
      expect(turnAEntries.every((e) => e.turnId === 'turn_a')).toBe(true);

      // 4. Test filtering by type
      const compactionEntries = listEntries(db.raw, { type: 'compaction' });
      expect(compactionEntries).toHaveLength(1);
      expect(compactionEntries[0].id).toBe('cmp_1');

      const messageEntries = listEntries(db.raw, { type: 'message' });
      expect(messageEntries).toHaveLength(3);

      // 5. Test ordering (descending)
      const descEntries = listEntries(db.raw, { order: 'desc', limit: 2 });
      expect(descEntries).toHaveLength(2);
      expect(descEntries[0].id).toBe('cmp_1');

      // 6. Test getHistoryStats
      const stats = getHistoryStats(db.raw);
      expect(stats.totalEntries).toBe(4);
      expect(stats.totalMessages).toBe(3);
      expect(stats.totalCompactions).toBe(1);
      expect(stats.totalTurns).toBe(2);
      expect(stats.latestSeq).toBe(4);

      // 7. Test listRoverTurns
      const turns = listRoverTurns(db.raw);
      expect(turns).toHaveLength(2);
    });
  });
});
