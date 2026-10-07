import { describe, it, expect, beforeEach } from 'vitest';
import { createContainer, getDefaultContainer, resetDefaultContainer } from '../container.js';

describe('Container Composition Root (ADR-0020)', () => {
  beforeEach(() => {
    resetDefaultContainer();
  });

  it('creates an immutable container holding db, models, and skills services', () => {
    const container = createContainer();

    expect(container.db).toBeDefined();
    expect(container.models).toBeDefined();
    expect(container.skills).toBeDefined();
    expect(container.tasks).toBeDefined();
    expect(container.agent).toBeDefined();
    expect(Object.isFrozen(container)).toBe(true);
  });

  it('manages defaultContainer singleton lifecycle', () => {
    const c1 = getDefaultContainer();
    const c2 = getDefaultContainer();

    expect(c1).toBe(c2);

    resetDefaultContainer();
    const c3 = getDefaultContainer();
    expect(c3).not.toBe(c1);
  });
});
