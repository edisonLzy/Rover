import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { inject } from 'postject';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(runtimeRoot, '../..');
const tauriRoot = path.join(workspaceRoot, 'packages/app/src-tauri');

function requestedTarget() {
  const args = process.argv.slice(2);
  const assignment = args.find((arg) => arg.startsWith('--target='));
  if (assignment) return assignment.slice('--target='.length);
  const index = args.indexOf('--target');
  if (index !== -1 && args[index + 1]) return args[index + 1];
  return execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
}

async function main() {
  const pinnedNode = (await fs.readFile(path.join(workspaceRoot, '.node-version'), 'utf8')).trim();
  if (process.version !== `v${pinnedNode}`) {
    throw new Error(
      `Node ${pinnedNode} is required to build the sidecar; running ${process.version}`
    );
  }

  const hostTarget = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
  const target = requestedTarget();
  if (target !== hostTarget) {
    throw new Error(
      `SEA must be built on the target architecture: requested ${target}, host ${hostTarget}`
    );
  }

  const distDir = path.join(runtimeRoot, 'dist');
  const binariesDir = path.join(tauriRoot, 'binaries');
  await fs.mkdir(distDir, { recursive: true });
  await fs.mkdir(binariesDir, { recursive: true });

  const bundle = path.join(distDir, 'bundle.cjs');
  const blob = path.join(distDir, 'sea-prep.blob');
  const config = path.join(distDir, 'sea-config.json');
  const extension = process.platform === 'win32' ? '.exe' : '';
  const binary = path.join(binariesDir, `rover-runtime-${target}${extension}`);

  await esbuild.build({
    entryPoints: [path.join(runtimeRoot, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: bundle,
  });

  await fs.writeFile(
    config,
    JSON.stringify({
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    })
  );
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  await fs.copyFile(process.execPath, binary);

  if (process.platform === 'darwin') {
    try {
      execFileSync('codesign', ['--remove-signature', binary]);
    } catch {
      // Some Node distributions are already unsigned.
    }
  }

  await inject(binary, 'NODE_SEA_BLOB', await fs.readFile(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: 'NODE_SEA',
    overwrite: true,
  });

  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', binary], { stdio: 'inherit' });
  }
  if (process.platform !== 'win32') await fs.chmod(binary, 0o755);

  console.log(`Built ${binary} with Node ${pinnedNode}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
