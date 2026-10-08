import type Database from 'better-sqlite3';
import type { WebSocketManager } from '../../../../transport/websocket.js';
import { appendRuntimeEvent } from '../../../../infrastructure/database/events.js';
import type {
  AgentRuntimeEventCallbacks,
  MessageDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  TurnContext,
  TurnEndResult,
} from '../../types.js';

export interface WebSocketBroadcastCallbacksOptions {
  wsManager?: WebSocketManager;
  db?: Database.Database;
}

/**
 * WebSocketBroadcastCallbacks
 *
 * 专注于 ADR-0017 规范的流式事件推送与 runtime_event 台账同步：
 * 广播 turn.started, turn.step_started, turn.delta, turn.tool_call, turn.tool_result, turn.end
 */
export class WebSocketBroadcastCallbacks implements AgentRuntimeEventCallbacks {
  private wsManager?: WebSocketManager;
  private db?: Database.Database;

  constructor(options: WebSocketBroadcastCallbacksOptions | WebSocketManager) {
    if (options && 'broadcast' in options && typeof options.broadcast === 'function') {
      this.wsManager = options as WebSocketManager;
    } else if (options && typeof options === 'object') {
      const opts = options as WebSocketBroadcastCallbacksOptions;
      this.wsManager = opts.wsManager;
      this.db = opts.db;
    }
  }

  public setWebSocketManager(wsManager?: WebSocketManager): void {
    this.wsManager = wsManager;
  }

  public setDatabase(db?: Database.Database): void {
    this.db = db;
  }

  /**
   * 记录 runtime_event 并向已连接的 WebSocket 客户端广播事件
   */
  public broadcast(eventType: string, payload: unknown): void {
    let eventSeq: number | undefined;

    if (this.db) {
      const event = appendRuntimeEvent(this.db, {
        eventType,
        payload,
        createdAt: Date.now(),
      });
      eventSeq = event.eventSeq;
    }

    if (this.wsManager) {
      this.wsManager.broadcast({
        type: eventType,
        payload: {
          ...(eventSeq !== undefined ? { eventSeq } : {}),
          ...(payload && typeof payload === 'object' ? payload : { data: payload }),
        },
      });
    }
  }

  public onTurnStart(context: TurnContext): void {
    this.broadcast('turn.started', {
      turnId: context.turnId,
      createdAt: context.startTime,
    });
  }

  public onTurnStepStart(context: TurnContext): void {
    this.broadcast('turn.step_started', {
      turnId: context.turnId,
      timestamp: Date.now(),
    });
  }

  public onMessageDelta(context: TurnContext, event: MessageDeltaEvent): void {
    this.broadcast('turn.delta', {
      turnId: context.turnId,
      ...(event.isThinking ? { thinkingDelta: event.delta } : { textDelta: event.delta }),
      accumulated: event.accumulated,
      isThinking: event.isThinking,
    });
  }

  public onToolExecutionStart(context: TurnContext, event: ToolCallEvent): void {
    this.broadcast('turn.tool_call', {
      turnId: context.turnId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
    });
  }

  public onToolExecutionEnd(context: TurnContext, event: ToolResultEvent): void {
    this.broadcast('turn.tool_result', {
      turnId: context.turnId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      result: event.result,
      isError: event.isError,
    });
  }

  public onTurnEnd(context: TurnContext, result: TurnEndResult): void {
    this.broadcast('turn.end', {
      turnId: context.turnId,
      status: result.status,
      error: result.error ?? null,
      latencyMs: result.latencyMs,
    });
  }
}
