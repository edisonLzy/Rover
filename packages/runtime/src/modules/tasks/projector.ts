/**
 * Task State Machine and Event Projector.
 *
 * Implements ADR-0010, TRD Section 5 & Ticket 007:
 * - Ingests Spool envelopes and projects them into task_event records.
 * - Enforces idempotent deduplication via (task_id, source, source_event_id).
 * - Projects lifecycle states:
 *     SessionStart -> running
 *     PermissionRequest / waiting -> needs_intervention
 *     UserPromptSubmit / PreToolUse -> running
 *     Stop -> single turn pause (NEVER completed)
 *     Report(status: "completed") -> completed (with result_text)
 *     Report(status: "failed") -> failed
 *     Carrier exit without report -> unverified (strictly prevents unverified success assumptions)
 * - Broadcasts task.changed via WebSocket.
 */

import type Database from 'better-sqlite3';
import type { TaskAgent, TaskRecord, TaskStatus } from './types.js';
import {
  commitTaskWithSession,
  getDispatchAttempt,
  getTask,
  findTaskByAttemptId,
  findTaskByNativeSessionId,
  insertTaskEvent,
  updateSessionRefAvailability,
  updateTaskStatus,
} from './repository.js';
import type { WebSocketManager } from '../../transport/websocket.js';
import type { SessionCarrier } from '../../infrastructure/dispatch/carrier.js';
import type { SpoolEnvelope, TaskProjectionResult } from '../../infrastructure/observe/index.js';

export interface TaskStateProjectorOptions {
  db: Database.Database;
  wsManager?: WebSocketManager;
  carrier?: SessionCarrier;
}

/**
 * Extracts a stable, idempotent source_event_id from a SpoolEnvelope.
 */
export function extractSourceEventId(envelope: SpoolEnvelope, _evidenceRef?: string): string {
  if (envelope.sourceEventId && envelope.sourceEventId.trim()) {
    return envelope.sourceEventId.trim();
  }
  if (envelope.eventId && envelope.eventId.trim()) {
    return envelope.eventId.trim();
  }
  const payload = envelope.payload;
  if (payload && typeof payload === 'object') {
    const candidate =
      payload.source_event_id ||
      payload.sourceEventId ||
      payload.event_id ||
      payload.eventId ||
      payload.id ||
      payload.tool_use_id;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (envelope.event === 'Report' && envelope.token) {
    return `report_${envelope.token}_${envelope.timestamp}`;
  }
  return `${envelope.event}_${envelope.timestamp}_${envelope.attemptId || 'anon'}`;
}

export class TaskStateProjector {
  private readonly db: Database.Database;
  private readonly wsManager?: WebSocketManager;
  private readonly carrier?: SessionCarrier;

  constructor(options: TaskStateProjectorOptions) {
    this.db = options.db;
    this.wsManager = options.wsManager;
    this.carrier = options.carrier;
  }

  /**
   * Resolves the TaskRecord corresponding to this envelope.
   */
  resolveTask(envelope: SpoolEnvelope): TaskRecord | null {
    // 1. By reservedTaskUuid
    if (envelope.reservedTaskUuid) {
      const task = getTask(this.db, envelope.reservedTaskUuid);
      if (task) return task;
    }

    // 2. By attemptId
    if (envelope.attemptId) {
      const task = findTaskByAttemptId(this.db, envelope.attemptId);
      if (task) return task;
    }

    // 3. By nativeSessionId in payload
    if (envelope.payload && typeof envelope.payload === 'object') {
      const nativeSessionId =
        envelope.payload.session_id || envelope.payload.sessionId || envelope.payload.id;
      const agent = (envelope.agentType || envelope.payload.agent) as TaskAgent | undefined;
      if (typeof nativeSessionId === 'string' && nativeSessionId.trim() && agent) {
        const task = findTaskByNativeSessionId(this.db, agent, nativeSessionId.trim());
        if (task) return task;
      }
    }

    // 4. Deferred attempt handling:
    // If dispatch_attempt exists in DB but task not yet created (e.g. Codex SessionStart)
    if (envelope.attemptId) {
      const attempt = getDispatchAttempt(this.db, envelope.attemptId);
      if (attempt) {
        let existingTask = getTask(this.db, attempt.candidateTaskId);
        if (existingTask) return existingTask;

        // If SessionStart arrived, commit task now
        const nativeSessionId =
          envelope.payload?.session_id ||
          envelope.payload?.sessionId ||
          envelope.payload?.id ||
          attempt.nativeSessionId;

        if (nativeSessionId && typeof nativeSessionId === 'string' && nativeSessionId.trim()) {
          let goal = `Task dispatched to ${attempt.agent}`;
          if (attempt.sourceKind === 'turn') {
            try {
              const turnRow = this.db
                .prepare('SELECT prompt_doc FROM rover_turn WHERE id = ?')
                .get(attempt.sourceId) as { prompt_doc: string } | undefined;
              if (turnRow) {
                const doc = JSON.parse(turnRow.prompt_doc);
                if (typeof doc === 'string') {
                  goal = doc;
                } else if (doc && typeof doc === 'object') {
                  goal = doc.text || doc.content?.[0]?.text || goal;
                }
              }
            } catch {
              // Ignore parse error, use default goal
            }
          }

          const { task } = commitTaskWithSession(this.db, {
            attemptId: attempt.id,
            taskId: attempt.candidateTaskId,
            goal,
            agent: attempt.agent,
            nativeSessionId: nativeSessionId.trim(),
            configDir: attempt.cwd,
            carrierName: `carrier_${attempt.id}`,
            wsManager: this.wsManager,
            createdAt: envelope.timestamp,
          });
          return task;
        }
      }
    }

    return null;
  }

  /**
   * Projects a single SpoolEnvelope into the task lifecycle and task_event table.
   * Silently deduplicates repeated events according to (task_id, source, source_event_id).
   */
  async projectEnvelope(
    envelope: SpoolEnvelope,
    evidenceRef?: string
  ): Promise<TaskProjectionResult | null> {
    const task = this.resolveTask(envelope);
    if (!task) {
      return null;
    }

    const previousStatus = task.status;
    const source = envelope.agentType || task.agent || 'spool';
    const sourceEventId = extractSourceEventId(envelope, evidenceRef);
    const kind = envelope.event;
    const summary =
      envelope.summary ||
      (typeof envelope.payload?.summary === 'string' ? envelope.payload.summary : null) ||
      (typeof envelope.payload?.message === 'string' ? envelope.payload.message : null) ||
      envelope.result ||
      null;

    // 1. Idempotently insert task_event
    const insertResult = insertTaskEvent(this.db, {
      taskId: task.id,
      source,
      sourceEventId,
      kind,
      observedAt: envelope.timestamp || Date.now(),
      summary,
      evidenceRef: evidenceRef ?? null,
    });

    // 2. If duplicate, skip state transition
    if (!insertResult.inserted) {
      return {
        taskId: task.id,
        previousStatus,
        currentStatus: previousStatus,
        deduplicated: true,
        eventKind: kind,
        summary,
        resultText: task.resultText,
      };
    }

    // 3. State machine transitions
    let nextStatus: TaskStatus = previousStatus;
    let nextProgressText: string | null = task.progressText;
    let nextResultText: string | null = task.resultText;

    switch (kind) {
      case 'SessionStart': {
        if (previousStatus === 'needs_intervention' || previousStatus === 'unverified') {
          nextStatus = 'running';
        }
        updateSessionRefAvailability(this.db, task.id, 'available', envelope.timestamp);
        nextProgressText = summary || 'Session running';
        break;
      }

      case 'PermissionRequest': {
        // Explicit waiting for user input / confirmation
        nextStatus = 'needs_intervention';
        nextProgressText = summary || 'Waiting for user permission in terminal';
        break;
      }

      case 'UserPromptSubmit':
      case 'PreToolUse':
      case 'PostToolUse': {
        // Activity detected; restore running if previously waiting for intervention
        if (previousStatus === 'needs_intervention') {
          nextStatus = 'running';
          nextProgressText = summary || 'Resumed execution';
        } else if (summary) {
          nextProgressText = summary;
        }
        break;
      }

      case 'Stop': {
        // Single turn pause only, NEVER marks completed!
        if (summary) {
          nextProgressText = summary;
        }
        break;
      }

      case 'Report': {
        // Explicit DoD report by Code Agent
        const reportStatus = envelope.status;
        if (reportStatus === 'completed') {
          nextStatus = 'completed';
          nextResultText = envelope.result || envelope.summary || 'Task completed successfully';
          nextProgressText = envelope.summary || nextResultText;
        } else if (reportStatus === 'failed') {
          nextStatus = 'failed';
          nextResultText = envelope.result || envelope.summary || 'Task failed';
          nextProgressText = envelope.summary || nextResultText;
        } else if (reportStatus === 'cancelled') {
          nextStatus = 'failed';
          nextResultText = envelope.result || envelope.summary || 'Task cancelled';
          nextProgressText = envelope.summary || nextResultText;
        } else if (reportStatus === 'in_progress') {
          if (summary) {
            nextProgressText = summary;
          }
        }
        break;
      }

      case 'SessionEnd': {
        updateSessionRefAvailability(this.db, task.id, 'unavailable', envelope.timestamp);
        // Completed barrier: If not explicitly completed/failed, mark as unverified
        if (previousStatus !== 'completed' && previousStatus !== 'failed') {
          nextStatus = 'unverified';
          nextProgressText = summary || 'Session ended without completion report';
        }
        break;
      }

      default: {
        if (summary) {
          nextProgressText = summary;
        }
        break;
      }
    }

    // 4. Update task status if status or texts changed
    if (
      nextStatus !== previousStatus ||
      nextProgressText !== task.progressText ||
      nextResultText !== task.resultText
    ) {
      updateTaskStatus(this.db, {
        taskId: task.id,
        status: nextStatus,
        progressText: nextProgressText,
        resultText: nextResultText,
        updatedAt: envelope.timestamp,
        wsManager: this.wsManager,
      });
    }

    return {
      taskId: task.id,
      previousStatus,
      currentStatus: nextStatus,
      deduplicated: false,
      eventKind: kind,
      summary,
      resultText: nextResultText,
    };
  }

  /**
   * Handles carrier session termination (e.g. GNU Screen process exits or dies).
   * Invariant: If process exits without completed DoD report, must mark unverified!
   */
  handleCarrierExit(attemptIdOrTaskId: string, observedAt?: number): TaskRecord | null {
    const now = observedAt ?? Date.now();
    let task = getTask(this.db, attemptIdOrTaskId);
    if (!task) {
      task = findTaskByAttemptId(this.db, attemptIdOrTaskId);
    }
    if (!task) return null;

    updateSessionRefAvailability(this.db, task.id, 'unavailable', now);

    insertTaskEvent(this.db, {
      taskId: task.id,
      source: 'carrier',
      sourceEventId: `carrier_exit_${now}`,
      kind: 'carrier_exit',
      observedAt: now,
      summary: 'Carrier process exited',
    });

    if (task.status !== 'completed' && task.status !== 'failed') {
      return updateTaskStatus(this.db, {
        taskId: task.id,
        status: 'unverified',
        progressText: 'Carrier process exited unexpectedly without completion report',
        updatedAt: now,
        wsManager: this.wsManager,
      });
    }

    return task;
  }

  /**
   * Checks carrier liveness and handles carrier exit if process died.
   */
  async checkSessionCarrier(attemptId: string): Promise<TaskRecord | null> {
    if (!this.carrier) return null;
    const sessionInfo = await this.carrier.getSessionInfo(attemptId);
    if (!sessionInfo || sessionInfo.status === 'dead') {
      return this.handleCarrierExit(attemptId);
    }
    return null;
  }
}
