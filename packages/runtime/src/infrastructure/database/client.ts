import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseOptions, RoverDatabase } from './types.js';
import { runMigrations } from './migrator.js';

export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export function resolveDatabasePath(customPath?: string): string {
  if (customPath) {
    return customPath;
  }
  if (process.env.ROVER_DB_PATH) {
    return process.env.ROVER_DB_PATH;
  }
  // Default to standard macOS Application Support path
  return path.join(os.homedir(), 'Library', 'Application Support', 'Rover', 'rover.db');
}

export function openDatabase(options: DatabaseOptions = {}): RoverDatabase {
  const dbPath = resolveDatabasePath(options.path);
  const isMemory = dbPath === ':memory:' || dbPath.startsWith('file::memory:');

  if (!isMemory) {
    const parentDir = path.dirname(dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  const rawDb = new Database(dbPath, {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
    timeout: options.timeout ?? DEFAULT_BUSY_TIMEOUT_MS,
    verbose: options.verbose,
  });

  // Configure SQLite PRAGMAs per Rover MVP TRD Section 6 & Ticket 001
  rawDb.pragma(`busy_timeout = ${options.timeout ?? DEFAULT_BUSY_TIMEOUT_MS}`);
  rawDb.pragma('foreign_keys = ON');

  if (!isMemory) {
    const journalModeResult = rawDb.pragma('journal_mode = WAL', { simple: true });
    if (journalModeResult !== 'wal') {
      // Log or handle unexpected journal mode in non-memory DB
    }
  }

  const transaction = <T>(fn: () => T): T => {
    return rawDb.transaction(fn)();
  };

  const close = (): void => {
    if (rawDb.open) {
      rawDb.close();
    }
  };

  return {
    raw: rawDb,
    path: dbPath,
    isMemory,
    close,
    transaction,
  };
}

let defaultDbInstance: RoverDatabase | null = null;

export function getDefaultDatabase(options: DatabaseOptions = {}): RoverDatabase {
  if (!defaultDbInstance) {
    defaultDbInstance = openDatabase(options);
    runMigrations(defaultDbInstance.raw);
  }
  return defaultDbInstance;
}

export function setDefaultDatabase(db: RoverDatabase | null): void {
  defaultDbInstance = db;
}

export function resetDefaultDatabase(): void {
  if (defaultDbInstance) {
    defaultDbInstance.close();
    defaultDbInstance = null;
  }
}
