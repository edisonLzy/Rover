/**
 * Task Event Consumer and Spool Orchestrator.
 *
 * Implements Ticket 007 & ADR-0010:
 * - Watches or drains atomic Spool files from the local spool directory.
 * - Hands events to TaskStateProjector for deduplication and lifecycle state projection.
 * - Coordinates carrier session lifecycle and reclamation.
 */

import type Database from 'better-sqlite3';
import type { SessionCarrier } from '../dispatch/carrier.js';
import type { DispatchAttempt } from '../dispatch/types.js';
import type { WebSocketManager } from '../../transport/websocket.js';
import type { TaskRecord } from '../../modules/tasks/types.js';
import { SpoolConsumer, type ConsumedEvent } from './spool.js';
import { TaskStateProjector } from '../../modules/tasks/projector.js';

export interface TaskEventConsumerOptions {
  db: Database.Database;
  spoolDir?: string;
  carrier?: SessionCarrier;
  wsManager?: WebSocketManager;
  deleteConsumedFiles?: boolean;
  autoStopCarrierOnComplete?: boolean;
}

export class TaskEventConsumer {
  readonly spoolConsumer: SpoolConsumer;
  readonly projector: TaskStateProjector;

  constructor(options: TaskEventConsumerOptions) {
    this.projector = new TaskStateProjector({
      db: options.db,
      wsManager: options.wsManager,
      carrier: options.carrier,
    });

    this.spoolConsumer = new SpoolConsumer({
      spoolDir: options.spoolDir,
      carrier: options.carrier,
      deleteConsumedFiles: options.deleteConsumedFiles,
      autoStopCarrierOnComplete: options.autoStopCarrierOnComplete ?? true,
      onEvent: async (event: ConsumedEvent) => {
        await this.projector.projectEnvelope(event.envelope, event.filename);
      },
    });
  }

  get spoolDir(): string {
    return this.spoolConsumer.spoolDir;
  }

  registerAttempt(attempt: DispatchAttempt): void {
    this.spoolConsumer.registerAttempt(attempt);
  }

  getAttempt(attemptId: string): DispatchAttempt | undefined {
    return this.spoolConsumer.getAttempt(attemptId);
  }

  async drain(): Promise<ConsumedEvent[]> {
    return this.spoolConsumer.drain();
  }

  startWatching(intervalMs = 200): void {
    this.spoolConsumer.startWatching(intervalMs);
  }

  stopWatching(): void {
    this.spoolConsumer.stopWatching();
  }

  handleCarrierExit(attemptIdOrTaskId: string): TaskRecord | null {
    return this.projector.handleCarrierExit(attemptIdOrTaskId);
  }

  async checkSessionCarrier(attemptId: string): Promise<TaskRecord | null> {
    return this.projector.checkSessionCarrier(attemptId);
  }
}
