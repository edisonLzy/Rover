/**
 * Spool Event Ingestion and Session State Consumer.
 *
 * Implements ADR-0010 and TRD Section 5 & 10:
 * - Reads atomic envelope files from Rover spool directory.
 * - Idempotently processes Hook events and DoD reports.
 * - Supports automatic deferred session confirmation.
 * - Triggers carrier session reclamation upon terminal events.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionCarrier } from '../dispatch/carrier.js';
import type { DispatchAttempt, SessionRefCandidate } from '../dispatch/types.js';
import { confirmNativeSession } from '../dispatch/dispatcher.js';

export interface SpoolEnvelope {
  attemptId: string;
  event: string;
  timestamp: number;
  payload?: any;
  agentType?: string;
  reservedTaskUuid?: string;
  // Report command fields
  token?: string;
  status?: string;
  result?: string;
  summary?: string;
}

export interface ConsumedEvent {
  filename: string;
  filePath: string;
  envelope: SpoolEnvelope;
}

export interface SpoolConsumerOptions {
  spoolDir?: string;
  carrier?: SessionCarrier;
  attempts?: Map<string, DispatchAttempt>;
  onSessionConfirmed?: (candidate: SessionRefCandidate) => void | Promise<void>;
  onEvent?: (event: ConsumedEvent) => void | Promise<void>;
  onTerminalReport?: (envelope: SpoolEnvelope) => void | Promise<void>;
  autoStopCarrierOnComplete?: boolean;
  deleteConsumedFiles?: boolean;
}

/**
 * Resolves standard default spool directory across platforms.
 * Matches packages/app/src-tauri/src/bin/rover-hook-helper.rs.
 */
export function getDefaultSpoolDir(): string {
  if (process.env.ROVER_SPOOL_DIR && process.env.ROVER_SPOOL_DIR.trim()) {
    return process.env.ROVER_SPOOL_DIR.trim();
  }

  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Rover', 'spool');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Rover', 'spool');
  }
  return path.join(home, '.local', 'share', 'rover', 'spool');
}

export class SpoolConsumer {
  readonly spoolDir: string;
  private readonly carrier?: SessionCarrier;
  private readonly attempts: Map<string, DispatchAttempt>;
  private readonly onSessionConfirmed?: (candidate: SessionRefCandidate) => void | Promise<void>;
  private readonly onEvent?: (event: ConsumedEvent) => void | Promise<void>;
  private readonly onTerminalReport?: (envelope: SpoolEnvelope) => void | Promise<void>;
  private readonly autoStopCarrierOnComplete: boolean;
  private readonly deleteConsumedFiles: boolean;

  private readonly processedFiles = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(options: SpoolConsumerOptions = {}) {
    this.spoolDir = options.spoolDir || getDefaultSpoolDir();
    this.carrier = options.carrier;
    this.attempts = options.attempts || new Map();
    this.onSessionConfirmed = options.onSessionConfirmed;
    this.onEvent = options.onEvent;
    this.onTerminalReport = options.onTerminalReport;
    this.autoStopCarrierOnComplete = options.autoStopCarrierOnComplete ?? true;
    this.deleteConsumedFiles = options.deleteConsumedFiles ?? false;
  }

  registerAttempt(attempt: DispatchAttempt): void {
    this.attempts.set(attempt.attemptId, attempt);
  }

  getAttempt(attemptId: string): DispatchAttempt | undefined {
    return this.attempts.get(attemptId);
  }

  /**
   * Scans and consumes all pending spool files synchronously/atomically.
   * Returns array of newly consumed events in temporal sequence.
   */
  async drain(): Promise<ConsumedEvent[]> {
    if (!fs.existsSync(this.spoolDir)) {
      return [];
    }

    const allEntries = fs.readdirSync(this.spoolDir);

    // Filter only target JSON files, ignoring partial temp files (tmp_*.tmp)
    const jsonFiles = allEntries
      .filter((file) => file.endsWith('.json') && !file.startsWith('tmp_'))
      .sort(); // Natural chronological sort due to timestamp prefix

    const consumed: ConsumedEvent[] = [];

    for (const filename of jsonFiles) {
      if (this.processedFiles.has(filename)) {
        continue;
      }

      const filePath = path.join(this.spoolDir, filename);
      let rawContent = '';

      try {
        rawContent = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        // File may have been removed or locked momentarily
        continue;
      }

      let envelope: SpoolEnvelope;
      try {
        envelope = JSON.parse(rawContent) as SpoolEnvelope;
      } catch {
        // Corrupted JSON; ignore or skip
        continue;
      }

      const consumedItem: ConsumedEvent = {
        filename,
        filePath,
        envelope,
      };

      this.processedFiles.add(filename);
      consumed.push(consumedItem);

      await this.handleEnvelope(consumedItem);

      if (this.deleteConsumedFiles) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Ignore deletion error
        }
      }
    }

    return consumed;
  }

  private async handleEnvelope(item: ConsumedEvent): Promise<void> {
    const { envelope } = item;

    // 1. Invoke generic onEvent listener
    if (this.onEvent) {
      await this.onEvent(item);
    }

    const attempt = this.attempts.get(envelope.attemptId);

    // 2. Handle deferred session confirmation (e.g. Codex SessionStart)
    if (envelope.event === 'SessionStart' && attempt && attempt.status === 'launched') {
      const nativeId =
        envelope.payload?.session_id ||
        envelope.payload?.sessionId ||
        envelope.payload?.id;

      if (typeof nativeId === 'string' && nativeId.trim()) {
        try {
          const candidate = confirmNativeSession(attempt, nativeId.trim());
          if (this.onSessionConfirmed) {
            await this.onSessionConfirmed(candidate);
          }
        } catch {
          // Mismatched or already confirmed
        }
      }
    }

    // 3. Handle DoD report events & automatic carrier reclamation
    if (envelope.event === 'Report') {
      const isTerminal =
        envelope.status === 'completed' ||
        envelope.status === 'failed' ||
        envelope.status === 'cancelled';

      if (isTerminal) {
        if (this.onTerminalReport) {
          await this.onTerminalReport(envelope);
        }

        if (this.autoStopCarrierOnComplete && this.carrier) {
          try {
            if (typeof this.carrier.stopSession === 'function') {
              await this.carrier.stopSession(envelope.attemptId);
            } else {
              await this.carrier.killSession(envelope.attemptId);
            }
          } catch {
            // Carrier session may have already exited
          }
        }
      }
    }
  }

  /**
   * Starts periodic polling of the spool directory.
   */
  startWatching(intervalMs = 200): void {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(async () => {
      if (this.isProcessing) return;
      this.isProcessing = true;
      try {
        await this.drain();
      } finally {
        this.isProcessing = false;
      }
    }, intervalMs);
  }

  /**
   * Stops periodic polling.
   */
  stopWatching(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
