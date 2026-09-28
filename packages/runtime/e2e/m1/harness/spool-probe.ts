import fs from 'node:fs';
import path from 'node:path';
import { SpoolConsumer, type DispatchAttempt, type SpoolEnvelope } from '../../../src/index.js';
import { pollUntil } from './polling.js';

export interface RecordedSpoolEnvelope {
  filename: string;
  envelope: SpoolEnvelope;
}

export function readSpoolEnvelopes(spoolDir: string): RecordedSpoolEnvelope[] {
  if (!fs.existsSync(spoolDir)) return [];

  return fs
    .readdirSync(spoolDir)
    .filter((filename) => filename.endsWith('.json') && !filename.startsWith('tmp_'))
    .sort()
    .flatMap((filename) => {
      try {
        const envelope = JSON.parse(
          fs.readFileSync(path.join(spoolDir, filename), 'utf8')
        ) as SpoolEnvelope;
        return [{ filename, envelope }];
      } catch {
        return [];
      }
    });
}

export async function waitForNativeSession(
  attempt: DispatchAttempt,
  spoolDir: string,
  timeoutMs = 45_000
): Promise<string> {
  const consumer = new SpoolConsumer({
    spoolDir,
    attempts: new Map([[attempt.attemptId, attempt]]),
    autoStopCarrierOnComplete: false,
  });

  return pollUntil(
    async () => {
      await consumer.drain();
      return attempt.status === 'confirmed' && attempt.nativeSessionId
        ? attempt.nativeSessionId
        : null;
    },
    { description: `${attempt.agentType} SessionStart hook`, timeoutMs }
  );
}

export async function waitForNewSessionStart(
  spoolDir: string,
  knownFiles: Set<string>,
  nativeSessionId: string,
  timeoutMs = 45_000
): Promise<RecordedSpoolEnvelope> {
  return pollUntil(
    () => {
      return (
        readSpoolEnvelopes(spoolDir).find(({ filename, envelope }) => {
          if (knownFiles.has(filename) || envelope.event !== 'SessionStart') return false;
          const eventSessionId =
            envelope.payload?.session_id || envelope.payload?.sessionId || envelope.payload?.id;
          return eventSessionId === nativeSessionId;
        }) ?? null
      );
    },
    { description: `resumed SessionStart for ${nativeSessionId}`, timeoutMs }
  );
}

export async function waitForSpoolEvent(
  spoolDir: string,
  predicate: (event: RecordedSpoolEnvelope) => boolean,
  description: string,
  timeoutMs = 120_000
): Promise<RecordedSpoolEnvelope> {
  return pollUntil(() => readSpoolEnvelopes(spoolDir).find(predicate) ?? null, {
    description,
    timeoutMs,
    intervalMs: 300,
  });
}

export async function waitForHookMarker(
  markerPath: string,
  eventName: string,
  timeoutMs = 15_000
): Promise<string[]> {
  return pollUntil(
    () => {
      if (!fs.existsSync(markerPath)) return null;
      const lines = fs.readFileSync(markerPath, 'utf8').split(/\r?\n/).filter(Boolean);
      return lines.includes(eventName) ? lines : null;
    },
    { description: `real CLI to invoke its ${eventName} Hook`, timeoutMs }
  );
}
