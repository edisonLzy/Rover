import type Database from 'better-sqlite3';

export interface DatabaseOptions {
  /**
   * Path to the SQLite database file.
   * Special value ':memory:' creates an in-memory database.
   * If omitted, falls back to process.env.ROVER_DB_PATH or macOS default path.
   */
  path?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
}

export interface RoverDatabase {
  raw: Database.Database;
  path: string;
  isMemory: boolean;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface RuntimeEvent<T = unknown> {
  eventSeq: number;
  eventType: string;
  payload: T;
  createdAt: number;
}

export interface AppendEventOptions {
  eventType: string;
  payload: unknown;
  createdAt?: number;
}
