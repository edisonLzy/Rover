/**
 * Safe File System Utilities for Hook Configurations.
 *
 * Enforces mandatory backups (*.rover.bak) and atomic writes.
 */

import fs from 'node:fs';
import path from 'node:path';

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
