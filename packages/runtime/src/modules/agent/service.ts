import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RoverDatabase } from '../../infrastructure/database/index.js';
import type { ModelService } from '../models/index.js';
import type { SkillService } from '../skills/index.js';
import { createAgentRuntime } from './runtime/index.js';
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

export class AgentService {
  public runtime: AgentRuntime;
  private db: Database.Database;
  private modelService: ModelService;
  private skillService?: SkillService;

  constructor(deps: AgentServiceDependencies) {
    const rawDb = 'raw' in deps.db ? deps.db.raw : deps.db;
    this.db = rawDb;
    this.modelService = deps.modelService;
    this.skillService = deps.skillService;
    const dbInstance: RoverDatabase =
      'raw' in deps.db
        ? deps.db
        : {
            raw: rawDb,
            path: ':memory:',
            isMemory: true,
            close: () => rawDb.close(),
            transaction: <T>(fn: () => T): T => (rawDb.transaction(fn) as () => T)(),
          };
    this.runtime =
      deps.runtime ??
      createAgentRuntime({
        db: dbInstance,
        modelRegistry: deps.modelService.getRegistry(),
        skillService: deps.skillService,
        wsManager: deps.wsManager,
      });
  }

  getRuntime(): AgentRuntime {
    return this.runtime;
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  getModelService(): ModelService {
    return this.modelService;
  }

  async startTurn(input: StartTurnInput): Promise<StartTurnResult> {
    if (this.runtime.isTurnRunning()) throw new Error('A Rover turn is already running');
    const activeModel = this.modelService.getRegistry().resolveActiveModel();
    if (!activeModel) {
      throw new Error('No active model configured in ~/.rover/models.json');
    }
    const turnId = input.turnId || crypto.randomUUID();
    // Fire-and-forget background execution, frontend subscribes via WebSocket
    void this.runtime
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
    this.runtime.abortPrompt();
    return { success: true, turnId };
  }

  steer(content: string): { success: boolean } {
    this.runtime.steer({ content });
    return { success: true };
  }

  clearAllQueues(): { success: boolean } {
    this.runtime.clearAllQueues();
    return { success: true };
  }

  getTurn(turnId: string): TurnDetails {
    const turn = getRoverTurn(this.db, turnId);
    const entries = getTurnEntries(this.db, turnId);
    return { turn, entries };
  }

  getFeed(options?: ListEntriesOptions): RoverEntryRecord[] {
    return listEntries(this.db, options ?? {});
  }

  getStats(): HistoryStats {
    return getHistoryStats(this.db);
  }

  getEffectiveHistory(): EffectiveHistory {
    return getEffectiveHistory(this.db);
  }

  listTurns(options?: ListRoverTurnsOptions): RoverTurnRecord[] {
    return listRoverTurns(this.db, options ?? {});
  }
}
