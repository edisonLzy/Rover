import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(runtimeRoot, '../..');
const target = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const tauriRoot = path.join(workspaceRoot, 'packages/app/src-tauri');
const binary = process.argv.includes('--packaged')
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

const token = 'rover_sidecar_smoke_test';
const env = { ...process.env, PATH: '' };
delete env.NODE_OPTIONS;
delete env.NODE_PATH;
const child = spawn(binary, ['--port=0', `--token=${token}`, '--host=127.0.0.1'], { env });
let stderr = '';
child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
let timeout;

try {
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
  console.log(`Sidecar started without Node on PATH and passed health check: ${binary}`);
} finally {
  clearTimeout(timeout);
  child.kill();
}
