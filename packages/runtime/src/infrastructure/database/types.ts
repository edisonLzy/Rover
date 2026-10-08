import type Database from 'better-sqlite3';

export interface DatabaseOptions {
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
  close: () => void;
  transaction: <T>(fn: () => T) => T;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}
