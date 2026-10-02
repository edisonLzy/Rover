import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { WebSocketManager } from '../transport/websocket.js';
import {
  appendMessageEntry,
  appendRuntimeEvent,
  getRoverTurn,
  getTurnEntries,
  updateRoverTurnStatus,
  type RoverTurnStatus,
  type AgentMessage as StorageAgentMessage,
} from '../storage/index.js';

export interface TurnExecutionResult {
  turnId: string;
  status: RoverTurnStatus;
  newMessages: AgentMessage[];
  error?: string | null;
}

export interface AgentEventHandlerOptions {
  db: Database.Database;
  wsManager?: WebSocketManager;
  turnId?: string;
  startTime?: number;
  onComplete?: (result: TurnExecutionResult) => void;
}

/**
 * AgentEventHandler
 *
 * 统一管理 Agent 回合状态 (currentTurnId / startTime) 与 Pi Agent Core 的流式生命周期事件：
 * 1. 响应 agent_start / agent_end 形成对称闭环的回合生命周期（自动广播 turn.started 与 turn.end）
 * 2. SQLite rover_entry 的不可变顺序落盘（严格保障 ADR-0014 WAL 原则）
 * 3. SQLite runtime_event 持久化台账
 * 4. WebSocket 实时双向流式事件广播 (turn.started, turn.step_started, turn.delta, turn.tool_*, turn.end)
 * 5. RoverTurn 终态决算与回调通知 (onComplete, fail, cancel)
 */
export class AgentEventHandler {
  private db: Database.Database;
  private wsManager?: WebSocketManager;
  private _currentTurnId: string | null = null;
  private currentTurnStartTime = 0;
  private onComplete?: ((result: TurnExecutionResult) => void) | null = null;
  private persistedMessages = new WeakSet<object>();
  private activeTurns = new Set<string>();

  constructor(options: AgentEventHandlerOptions) {
    this.db = options.db;
    this.wsManager = options.wsManager;
    if (options.turnId) {
      this.startTurn(options.turnId, options.onComplete, options.startTime);
    }
  }

  public get currentTurnId(): string | null {
    return this._currentTurnId;
  }

  public get isRunning(): boolean {
    return this._currentTurnId !== null;
  }

  public get startTime(): number {
    return this.currentTurnStartTime;
  }

  public isTurnActive(turnId: string): boolean {
    return this._currentTurnId === turnId || this.activeTurns.has(turnId);
  }

  public setWebSocketManager(wsManager?: WebSocketManager): void {
    this.wsManager = wsManager;
  }

  /**
   * 绑定并开启新回合上下文
   */
  public startTurn(
    turnId: string,
    onComplete?: (result: TurnExecutionResult) => void,
    startTime?: number
  ): void {
    this._currentTurnId = turnId;
    this.currentTurnStartTime = startTime ?? Date.now();
    this.activeTurns.add(turnId);
    this.onComplete = onComplete ?? null;
  }

  /**
   * 将消息对象标记为已落盘，避免重复写入
   */
  public markPersisted(message: object): void {
    this.persistedMessages.add(message);
  }

  public isPersisted(message: object): boolean {
    return this.persistedMessages.has(message);
  }

  /**
   * 记录 runtime_event 并向已连接的 WebSocket 客户端广播事件
   */
  public broadcast(eventType: string, payload: unknown): void {
    const event = appendRuntimeEvent(this.db, {
      eventType,
      payload,
      createdAt: Date.now(),
    });

    if (this.wsManager) {
      this.wsManager.broadcast({
        type: eventType,
        payload: {
          eventSeq: event.eventSeq,
          ...(payload && typeof payload === 'object' ? payload : { data: payload }),
        },
      });
    }
  }

  /**
   * 统一处理 Pi Agent Core 的各类事件
   */
  public async handle(event: AgentEvent): Promise<void> {
    const turnId = this._currentTurnId;

    switch (event.type) {
      case 'agent_start': {
        if (!this.currentTurnStartTime) {
          this.currentTurnStartTime = Date.now();
        }
        this.broadcast('turn.started', {
          turnId,
          createdAt: this.currentTurnStartTime,
        });
        break;
      }

      case 'turn_start': {
        this.broadcast('turn.step_started', {
          turnId,
          timestamp: Date.now(),
        });
        break;
      }

      case 'message_update': {
        const update = event.assistantMessageEvent;
        if (update) {
          if (update.type === 'text_delta' && update.delta) {
            const fullText =
              (event.message.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? '';
            this.broadcast('turn.delta', {
              turnId,
              textDelta: update.delta,
              accumulated: fullText,
              isThinking: false,
            });
          } else if (update.type === 'thinking_delta' && update.delta) {
            const fullThinking =
              (event.message.content as Array<{ type: string; thinking?: string }>)?.[0]
                ?.thinking ?? '';
            this.broadcast('turn.delta', {
              turnId,
              thinkingDelta: update.delta,
              accumulated: fullThinking,
              isThinking: true,
            });
          }
        }
        break;
      }

      case 'message_end': {
        // WAL Invariant: 完整的 assistant 或 toolResult 消息产生后立即追加到 rover_entry
        if (
          turnId &&
          (event.message.role === 'assistant' || event.message.role === 'toolResult') &&
          !this.persistedMessages.has(event.message)
        ) {
          appendMessageEntry(this.db, {
            id: crypto.randomUUID(),
            turnId,
            message: event.message as unknown as StorageAgentMessage,
          });
          this.persistedMessages.add(event.message);
        }
        break;
      }

      case 'tool_execution_start': {
        this.broadcast('turn.tool_call', {
          turnId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      }

      case 'tool_execution_end': {
        this.broadcast('turn.tool_result', {
          turnId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        });
        break;
      }

      case 'agent_end': {
        this.handleAgentEnd();
        break;
      }
    }
  }

  /**
   * 终态决算：更新 rover_turn 数据库记录，广播 turn.end，触发 onComplete
   */
  public handleAgentEnd(
    overrideStatus?: RoverTurnStatus,
    overrideError?: string | null
  ): TurnExecutionResult {
    const turnId = this._currentTurnId;
    if (!turnId) {
      return { turnId: '', status: 'failed', newMessages: [], error: 'No active turn' };
    }

    const latencyMs = this.currentTurnStartTime > 0 ? Date.now() - this.currentTurnStartTime : 0;
    const currentTurn = getRoverTurn(this.db, turnId);
    const isCancelled = overrideStatus === 'cancelled' || currentTurn?.status === 'cancelled';
    const isFailed = overrideStatus === 'failed' || currentTurn?.status === 'failed';

    let finalStatus: RoverTurnStatus = overrideStatus ?? 'completed';
    let error: string | null = overrideError ?? null;

    if (isCancelled) {
      finalStatus = 'cancelled';
      error = error || currentTurn?.error || 'Turn cancelled by user';
    } else if (isFailed) {
      finalStatus = 'failed';
      error = error || currentTurn?.error || 'Turn execution failed';
    }

    updateRoverTurnStatus(this.db, {
      id: turnId,
      status: finalStatus,
      error,
      completedAt: Date.now(),
    });

    this.broadcast('turn.end', {
      turnId,
      status: finalStatus,
      error,
      latencyMs,
    });

    const turnMessages = getTurnEntries(this.db, turnId);
    const result: TurnExecutionResult = {
      turnId,
      status: finalStatus,
      newMessages: turnMessages.map((e) => e.data as unknown as AgentMessage),
      error,
    };

    const cb = this.onComplete;
    this.activeTurns.delete(turnId);
    this._currentTurnId = null;
    this.currentTurnStartTime = 0;
    this.onComplete = null;

    if (cb) {
      cb(result);
    }

    return result;
  }

  public fail(errorMessage: string): TurnExecutionResult {
    return this.handleAgentEnd('failed', errorMessage);
  }

  public cancel(reason = 'Turn cancelled by user'): TurnExecutionResult {
    return this.handleAgentEnd('cancelled', reason);
  }
}
