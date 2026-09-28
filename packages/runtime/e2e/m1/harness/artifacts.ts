import fs from 'node:fs';
import path from 'node:path';

const SECRET_KEYS = new Set(['token', 'reportToken', 'authorization', 'apiKey']);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEYS.has(key) ? '[REDACTED]' : redact(item),
      ])
    );
  }
  return value;
}

export function writeArtifact(directory: string, filename: string, value: unknown): void {
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, filename);
  const content = typeof value === 'string' ? value : JSON.stringify(redact(value), null, 2);
  fs.writeFileSync(target, `${content}\n`, 'utf8');
}
