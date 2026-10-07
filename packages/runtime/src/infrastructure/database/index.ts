export { openDatabase, resolveDatabasePath, DEFAULT_BUSY_TIMEOUT_MS } from './client.js';

export {
  runMigrations,
  getAppliedMigrationVersions,
  initMigrationTable,
  type MigrationResult,
} from './migrator.js';

export { INITIAL_SCHEMA_SQL, MIGRATIONS } from './migrations/index.js';

export {
  appendRuntimeEvent,
  getRuntimeEvents,
  getLatestEventSeq,
  type StoredRuntimeEvent,
  type AppendEventOptions,
  type GetEventsOptions,
} from './events.js';

export type { DatabaseOptions, RoverDatabase, Migration } from './types.js';
