import { describe, expect, it } from 'vitest';
import { RUNTIME_VERSION, getRuntimeStatus } from '../index.js';

describe('Runtime Baseline', () => {
  it('reports correct runtime version and status', () => {
    const status = getRuntimeStatus();
    expect(status.status).toBe('ready');
    expect(status.version).toBe(RUNTIME_VERSION);
  });
});
