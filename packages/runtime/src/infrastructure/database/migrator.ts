import type Database from 'better-sqlite3';
import type { Migration } from './types.js';
import { MIGRATIONS } from './migrations/index.js';

export interface MigrationResult {
  appliedCount: number;
  appliedVersions: number[];
  latestVersion: number;
}

export function initMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

export function getAppliedMigrationVersions(db: Database.Database): number[] {
  initMigrationTable(db);
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as {
    version: number;
  }[];
  return rows.map((r) => r.version);
}

export function runMigrations(
  db: Database.Database,
  migrations: Migration[] = MIGRATIONS
): MigrationResult {
  initMigrationTable(db);

  const appliedSet = new Set(getAppliedMigrationVersions(db));
  const pendingMigrations = migrations
    .filter((m) => !appliedSet.has(m.version))
    .sort((a, b) => a.version - b.version);

  const appliedVersions: number[] = [];

  for (const migration of pendingMigrations) {
    const applyMigration = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        Date.now()
      );
    });

    try {
      applyMigration();
      appliedVersions.push(migration.version);
    } catch (error) {
      throw new Error(
        `Failed to apply migration v${migration.version} ("${migration.name}"): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const allVersions = getAppliedMigrationVersions(db);
  const latestVersion = allVersions.length > 0 ? Math.max(...allVersions) : 0;

  return {
    appliedCount: appliedVersions.length,
    appliedVersions,
    latestVersion,
  };
}
