import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectM1E2EEnvironment } from './harness/prerequisites.js';
import { writeArtifact } from './harness/artifacts.js';

describe('M1 real CLI E2E prerequisites', () => {
  it('has the macOS, Screen, Terminal, helper, CLI, and authentication prerequisites', async () => {
    const environment = await inspectM1E2EEnvironment();
    const evidenceDir = path.resolve(process.cwd(), '../../test-results/m1-e2e/prerequisites');

    writeArtifact(evidenceDir, 'environment.json', environment);

    expect(environment.platform).toBe('darwin');
    expect(environment.screenPath).toBe('/usr/bin/screen');
    expect(environment.claudeVersion).toContain('Claude Code');
    expect(environment.codexVersion).toContain('codex-cli');
  });
});
