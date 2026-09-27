/**
 * Observer Utility Methods.
 *
 * Enforces mandatory backups (*.rover.bak), atomic writes, and standard path resolution.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DefaultPaths } from './_types.js';

/**
 * Resolves standard default paths for configuration files and hook helper binary.
 */
export function getDefaultPaths(): DefaultPaths {
  const home = os.homedir();
  return {
    claudeSettings: path.join(home, '.claude', 'settings.json'),
    codexHooks: path.join(home, '.codex', 'hooks.json'),
    opencodeConfig: path.join(home, '.config', 'opencode', 'opencode.json'),
    helperBinary:
      process.env.ROVER_HOOK_HELPER_PATH ||
      path.join(home, 'Library', 'Application Support', 'Rover', 'bin', 'rover-hook-helper'),
  };
}

export function safeReadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function safeWriteJsonWithBackup<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Mandatory backup before write
  if (fs.existsSync(filePath)) {
    const backupPath = `${filePath}.rover.bak`;
    fs.copyFileSync(filePath, backupPath);
  }

  const jsonContent = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = `${filePath}.tmp_${Date.now()}`;
  fs.writeFileSync(tempPath, jsonContent, 'utf-8');
  fs.renameSync(tempPath, filePath);
}
