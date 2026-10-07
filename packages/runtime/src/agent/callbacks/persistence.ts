import crypto from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  createRoverTurn,
  appendMessageEntry,
  updateRoverTurnStatus,
  type RoverDatabase,
  type AgentMessage as StorageAgentMessage,
} from '../../storage/index.js';
import { parsePromptDocumentContent } from '../prompts.js';
import { assessContextBudget } from '../compaction.js';
import type { AgentRuntimeEventCallbacks, TurnContext, TurnEndResult } from '../types.js';

/**
 * TurnPersistenceCallbacks
 *
 * 专注于 ADR-0014 规范的 SQLite WAL 消息粒度先行落盘与回合终态更新：
 * 1. onTurnStart：原子创建 rover_turn 并在事务中写入第一条 user entry
 * 2. onMessageEnd：在每次完整的 assistant 或 toolResult 消息产生后即刻落盘
 * 3. onTurnEnd：更新 rover_turn 终态 (completed / cancelled / failed)
 */
export class TurnPersistenceCallbacks implements AgentRuntimeEventCallbacks {
  private dbInstance: RoverDatabase;
  private persistedMessages = new WeakSet<object>();

  constructor(db: RoverDatabase) {
    this.dbInstance = db;
  }

  private get db() {
    return this.dbInstance.raw;
  }

  public isPersisted(message: object): boolean {
    return this.persistedMessages.has(message);
  }

  public markPersisted(message: object): void {
    this.persistedMessages.add(message);
  }

  /**
   * 回合开始前置触发：原子写入 rover_turn 与首条 user entry，并评估上下文预算
   */
  public async onTurnStart(context: TurnContext): Promise<void> {
    if (!context.userPrompt) {
      return;
    }

    const parsedPrompt = parsePromptDocumentContent(context.userPrompt);
    const userMessage: StorageAgentMessage = {
      role: 'user',
      content: parsedPrompt.plainText,
      timestamp: context.startTime,
    };

    // 1. 原子事务创建 rover_turn (status='running') 与首条 user entry
    this.dbInstance.transaction(() => {
      createRoverTurn(this.db, {
        id: context.turnId,
        promptDoc: context.userPrompt as unknown as Record<string, unknown>,
      });
      appendMessageEntry(this.db, {
        id: crypto.randomUUID(),
        turnId: context.turnId,
        message: userMessage,
      });
    });

    this.markPersisted(userMessage);

    // 2. 评估上下文预算 (ADR-0014)
    if (context.model) {
      assessContextBudget(this.db, {
        modelMaxTokens: context.model.contextWindow || 128000,
        safetyMarginTokens: 2000,
      });
    }
  }

  /**
   * 完整的 assistant 或 toolResult 消息生成完毕：严格遵循 ADR-0014 WAL 规范追加落盘
   */
  public async onMessageEnd(context: TurnContext, message: AgentMessage): Promise<void> {
    if (
      (message.role === 'assistant' || message.role === 'toolResult') &&
      !this.persistedMessages.has(message)
    ) {
      appendMessageEntry(this.db, {
        id: crypto.randomUUID(),
        turnId: context.turnId,
        message: message as unknown as StorageAgentMessage,
      });
      this.persistedMessages.add(message);
    }
  }

  /**
   * 回合结束终态决算：更新 rover_turn 数据库记录
   */
  public async onTurnEnd(context: TurnContext, result: TurnEndResult): Promise<void> {
    updateRoverTurnStatus(this.db, {
      id: context.turnId,
      status: result.status,
      error: result.error ?? null,
      completedAt: Date.now(),
    });
  }
}
