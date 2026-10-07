import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentRuntime } from './runtime/runtime.js';
import {
  getEffectiveHistory,
  getHistoryStats,
  getRoverTurn,
  getTurnEntries,
  listEntries,
  listRoverTurns,
} from './repository.js';
import type {
  AgentService,
  AgentServiceDependencies,
  EffectiveHistory,
  HistoryStats,
  ListEntriesOptions,
  ListRoverTurnsOptions,
  RoverEntryRecord,
  RoverTurnRecord,
  StartTurnInput,
  StartTurnResult,
  TurnDetails,
} from './types.js';

export class DefaultAgentService implements AgentService {
  private getRuntime: () => AgentRuntime;
  private getDatabase: () => Database.Database;

  constructor(deps: AgentServiceDependencies) {
    this.getRuntime = deps.getRuntime;
    this.getDatabase = deps.getDatabase;
  }

  async startTurn(input: StartTurnInput): Promise<StartTurnResult> {
    const runtime = this.getRuntime();
    const activeModel = runtime.getModelRegistry().resolveActiveModel();
    if (!activeModel) {
      throw new Error('No active model configured in ~/.rover/models.json');
    }
    const turnId = input.turnId || crypto.randomUUID();
    // Fire-and-forget background execution, frontend subscribes via WebSocket
    void runtime
      .prompt({
        turnId,
        promptDoc: input.promptDoc,
        model: activeModel,
      })
      .catch((err) => {
        console.error('[AgentService] runtime.prompt error in startTurn:', err);
      });

    return {
      turnId,
      status: 'running',
    };
  }

  cancelTurn(turnId: string): { success: boolean; turnId: string } {
    const runtime = this.getRuntime();
    runtime.abortPrompt();
    return { success: true, turnId };
  }

  steer(content: string): { success: boolean } {
    const runtime = this.getRuntime();
    runtime.steer({ content });
    return { success: true };
  }

  followUp(content: string): { success: boolean } {
    const runtime = this.getRuntime();
    runtime.followUp({ content });
    return { success: true };
  }

  clearAllQueues(): { success: boolean } {
    const runtime = this.getRuntime();
    runtime.clearAllQueues();
    return { success: true };
  }

  getTurn(turnId: string): TurnDetails {
    const db = this.getDatabase();
    const turn = getRoverTurn(db, turnId);
    const entries = getTurnEntries(db, turnId);
    return { turn, entries };
  }

  getFeed(options?: ListEntriesOptions): RoverEntryRecord[] {
    const db = this.getDatabase();
    return listEntries(db, options ?? {});
  }

  getStats(): HistoryStats {
    const db = this.getDatabase();
    return getHistoryStats(db);
  }

  getEffectiveHistory(): EffectiveHistory {
    const db = this.getDatabase();
    return getEffectiveHistory(db);
  }

  listTurns(options?: ListRoverTurnsOptions): RoverTurnRecord[] {
    const db = this.getDatabase();
    return listRoverTurns(db, options ?? {});
  }
}
