import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { BuiltinSkillService } from '../src/agent/skills/skill-service.ts';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(runtimeRoot, '../..');
const target = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const tauriRoot = path.join(workspaceRoot, 'packages/app/src-tauri');
const packaged = process.argv.includes('--packaged');
const binary = packaged
  ? process.platform === 'darwin'
    ? path.join(
        tauriRoot,
        `target/${target}/release/bundle/macos/Rover.app/Contents/MacOS/rover-runtime`
      )
    : path.join(tauriRoot, `target/${target}/release/rover-runtime.exe`)
  : path.join(
      tauriRoot,
      `binaries/rover-runtime-${target}${process.platform === 'win32' ? '.exe' : ''}`
    );

const sourceSkillsDir = path.join(workspaceRoot, 'packages/app/resources/skills');
const expectedSkills = new BuiltinSkillService({ skillsDir: sourceSkillsDir }).getSkills();
const smokeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rover sea smoke '));
const skillsDir = packaged
  ? process.platform === 'darwin'
    ? path.resolve(path.dirname(binary), '../Resources/skills')
    : path.join(path.dirname(binary), 'skills')
  : path.join(smokeDir, 'skills');

async function resourceHashes(dir, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(dir, relative), { withFileTypes: true })) {
    const childPath = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await resourceHashes(dir, childPath)));
    } else if (entry.isFile()) {
      result.push([
        childPath.split(path.sep).join('/'),
        createHash('sha256')
          .update(await fs.readFile(path.join(dir, childPath)))
          .digest('hex'),
      ]);
    } else {
      throw new Error(`Unsupported skill resource: ${childPath}`);
    }
  }
  return result.sort(([a], [b]) => a.localeCompare(b));
}

const token = 'rover_sidecar_smoke_test';
const env = { ...process.env, PATH: '', ROVER_DB_PATH: path.join(smokeDir, 'rover.db') };
delete env.NODE_OPTIONS;
delete env.NODE_PATH;
let child;
let stderr = '';
let timeout;

try {
  if (!packaged) await fs.cp(sourceSkillsDir, skillsDir, { recursive: true });
  assert.deepEqual(await resourceHashes(skillsDir), await resourceHashes(sourceSkillsDir));
  child = spawn(
    binary,
    ['--port=0', `--token=${token}`, '--host=127.0.0.1', `--skills-dir=${skillsDir}`],
    { env, cwd: smokeDir }
  );
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const ready = await Promise.race([
    new Promise((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        if (line.startsWith('[READY]')) resolve(line);
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Sidecar exited with ${code}: ${stderr}`)));
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Sidecar readiness timed out: ${stderr}`)),
        10_000
      );
    }),
  ]);
  const port = Number(ready.match(/\bport=(\d+)\b/)?.[1]);
  if (!port) throw new Error(`Invalid ready signal: ${ready}`);

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
  const client = createTRPCClient({
    links: [
      httpBatchLink({
        url: `http://127.0.0.1:${port}/trpc`,
        headers: { Authorization: `Bearer ${token}` },
        fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5_000) }),
      }),
    ],
  });
  assert.deepEqual(
    await client.skills.list.query(),
    expectedSkills.map(({ id, name, description }) => ({
      id,
      name,
      description,
      source: 'builtin',
      isEnabled: true,
    }))
  );
  for (const { name, body } of expectedSkills) {
    assert.deepEqual(await client.skills.read.query({ name }), { name, body });
  }
  console.log(
    `Sidecar passed health, skill content and resource checks without Node on PATH: ${binary}`
  );
} finally {
  clearTimeout(timeout);
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await fs.rm(smokeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
