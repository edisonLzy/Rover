import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../infrastructure/database/index.js';
import { historyRouter } from '../modules/agent/router.js';
import { appendMessageEntry, createRoverTurn, listEntries } from '../modules/agent/repository.js';
import type { Context } from '../trpc/context.js';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  createRoverTurn(db, { id: 'turn', promptDoc: {} });
  for (let index = 1; index <= 5; index++)
    appendMessageEntry(db, {
      turnId: 'turn',
      message: { role: 'assistant', content: `Message ${index}` },
    });
});
afterEach(() => db.close());
function caller() {
  return historyRouter.createCaller({
    isAuthenticated: true,
    container: {
      agentService: {
        getFeed: (input: Parameters<typeof listEntries>[1]) => listEntries(db, input),
      },
    },
  } as unknown as Context);
}
describe('history cursor pagination', () => {
  it('returns older records without overlaps while new messages arrive', async () => {
    const api = caller();
    const latest = await api.getFeed({ limit: 2, order: 'desc' });
    appendMessageEntry(db, {
      turnId: 'turn',
      message: { role: 'assistant', content: 'New message' },
    });
    const older = await api.getFeed({ limit: 2, order: 'desc', beforeSeq: latest.at(-1)!.seq });
    expect(older.map((entry) => entry.seq)).toEqual([3, 2]);
    expect(older.every((entry) => entry.seq < latest.at(-1)!.seq)).toBe(true);
  });
  it.each([0, -1, 1.5])('rejects invalid cursor %s', async (beforeSeq) => {
    await expect(caller().getFeed({ beforeSeq })).rejects.toThrow();
  });
});
