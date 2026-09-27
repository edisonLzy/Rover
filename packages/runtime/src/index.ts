/**
 * @rover/runtime - Core Agent Runtime for Rover
 */

import process from 'node:process';
import { createRuntimeServer } from './transport/index.js';

export const RUNTIME_VERSION = '0.1.0';

export interface RuntimeConfig {
  port: number;
  token: string;
  host?: string;
}

export interface RuntimeStatus {
  status: 'starting' | 'ready' | 'running' | 'stopped';
  version: string;
}

export function getRuntimeStatus(): RuntimeStatus {
  return {
    status: 'ready',
    version: RUNTIME_VERSION,
  };
}

export * from './transport/index.js';
export * from './router.js';
export * from './dispatch/screen.js';
export * from './dispatch/carrier.js';
export * from './dispatch/types.js';
export * from './dispatch/claude.js';
export * from './dispatch/codex.js';
export * from './dispatch/opencode.js';
export * from './dispatch/dispatcher.js';

/**
 * Parses CLI flags in format --key=value
 */
function parseCliArgs(): Partial<RuntimeConfig> {
  const args = process.argv.slice(2);
  const config: Partial<RuntimeConfig> = {};

  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      config.port = Number.parseInt(arg.slice(7), 10);
    } else if (arg.startsWith('--token=')) {
      config.token = arg.slice(8);
    } else if (arg.startsWith('--host=')) {
      config.host = arg.slice(7);
    }
  }

  // Also check environment variables as fallbacks
  if (!config.port && process.env.ROVER_PORT) {
    config.port = Number.parseInt(process.env.ROVER_PORT, 10);
  }
  if (!config.token && process.env.ROVER_TOKEN) {
    config.token = process.env.ROVER_TOKEN;
  }
  if (!config.host && process.env.ROVER_HOST) {
    config.host = process.env.ROVER_HOST;
  }

  return config;
}

/**
 * CLI auto-start hook when invoked directly from command line / sidecar
 */
async function main() {
  const config = parseCliArgs();

  // If token is provided, auto-start server
  if (config.token) {
    try {
      const server = await createRuntimeServer({
        port: config.port || 0,
        token: config.token,
        host: config.host || '127.0.0.1',
      });

      const addr = server.getAddress();
      // Stdout ready signal for Rust sidecar supervisor
      process.stdout.write(`[READY] port=${addr.port} host=${addr.host} token=${addr.token}\n`);

      const shutdown = async () => {
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (err) {
      process.stderr.write(`[ERROR] Failed to start runtime: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }
}

// Both the compiled module and SEA start only when the host supplies a token.
if (process.argv.some((arg) => arg.startsWith('--token='))) {
  void main();
}
