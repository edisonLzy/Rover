import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAsset, isSea } from 'node:sea';
import type { DatabaseOptions, RoverDatabase } from './types.js';

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

  const driverOptions: Database.Options = {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
    timeout: options.timeout ?? DEFAULT_BUSY_TIMEOUT_MS,
    verbose: options.verbose,
  };
  let nativeDirectory: string | undefined;
  let rawDb: Database.Database;
  try {
    if (isSea()) {
      nativeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-sqlite-'));
      const nativePath = path.join(nativeDirectory, 'better_sqlite3.node');
      fs.writeFileSync(nativePath, Buffer.from(getAsset('better_sqlite3.node')), { mode: 0o600 });
      driverOptions.nativeBinding = nativePath;
    }
    rawDb = new Database(dbPath, driverOptions);
  } finally {
    if (nativeDirectory) {
      // POSIX can unlink an already loaded addon. Windows may keep the DLL locked.
      try {
        fs.rmSync(nativeDirectory, { recursive: true, force: true });
      } catch {
        // Do not turn a successful database open into a startup failure on Windows.
      }
    }
  }

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
