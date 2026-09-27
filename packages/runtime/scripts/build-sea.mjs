import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { inject } from 'postject';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, '..');
const appRoot = path.resolve(runtimeRoot, '../app');

function getHostTargetTriple() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (platform === 'win32') {
    return arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'i686-pc-windows-msvc';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  throw new Error(`Unsupported host platform: ${platform} ${arch}`);
}

function parseTargetArg() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      return args[i + 1];
    }
    if (args[i].startsWith('--target=')) {
      return args[i].slice(9);
    }
  }
  return getHostTargetTriple();
}

async function main() {
  const targetTriple = parseTargetArg();
  console.log(`[SEA] Building Node.js Single Executable Application for ${targetTriple}...`);

  const distDir = path.join(runtimeRoot, 'dist');
  await fs.mkdir(distDir, { recursive: true });

  const bundlePath = path.join(distDir, 'bundle.cjs');
  const seaConfigPath = path.join(distDir, 'sea-config.json');
  const blobPath = path.join(distDir, 'sea-prep.blob');

  // 1. Bundle TypeScript runtime to single CommonJS bundle
  console.log('[SEA] Bundling @rover/runtime into single CommonJS file via esbuild...');
  await esbuild.build({
    entryPoints: [path.join(runtimeRoot, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'warning',
  });

  // 2. Generate sea-config.json
  const seaConfig = {
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  };
  await fs.writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf-8');

  // 3. Generate preparation blob
  console.log('[SEA] Generating SEA preparation blob via Node.js...');
  execSync(`"${process.execPath}" --experimental-sea-config "${seaConfigPath}"`, {
    stdio: 'inherit',
    cwd: runtimeRoot,
  });

  // 4. Prepare target executable in packages/app/src-tauri/binaries/
  const binariesDir = path.join(appRoot, 'src-tauri', 'binaries');
  await fs.mkdir(binariesDir, { recursive: true });

  const isWindows = targetTriple.includes('windows') || process.platform === 'win32';
  const ext = isWindows ? '.exe' : '';
  const targetBinary = path.join(binariesDir, `rover-runtime-${targetTriple}${ext}`);

  console.log(`[SEA] Copying Node executable to ${targetBinary}...`);
  await fs.copyFile(process.execPath, targetBinary);

  // 5. Remove existing signatures on macOS
  if (process.platform === 'darwin') {
    try {
      execSync(`codesign --remove-signature "${targetBinary}"`, { stdio: 'ignore' });
    } catch {
      // Signature might not exist or already removed
    }
  }

  // 6. Inject preparation blob using postject
  console.log('[SEA] Injecting NODE_SEA_BLOB into target binary...');
  const blobBuffer = await fs.readFile(blobPath);
  await inject(targetBinary, 'NODE_SEA_BLOB', blobBuffer, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: 'NODE_SEA',
    overwrite: true,
  });

  // 7. Re-sign binary on macOS
  if (process.platform === 'darwin') {
    execSync(`codesign --sign - "${targetBinary}"`, { stdio: 'ignore' });
    await fs.chmod(targetBinary, 0o755);
  }

  const stat = await fs.stat(targetBinary);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`[SEA] Successfully built ${targetBinary} (${sizeMb} MB)`);
}

main().catch((err) => {
  console.error('[SEA] Build failed:', err);
  process.exit(1);
});
