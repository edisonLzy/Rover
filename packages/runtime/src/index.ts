/**
 * @rover/runtime - Core Agent Runtime for Rover
 */

export interface RuntimeConfig {
  port: number;
  token: string;
}

export interface RuntimeStatus {
  status: 'starting' | 'ready' | 'running' | 'stopped';
  version: string;
}

export const RUNTIME_VERSION = '0.1.0';

export function getRuntimeStatus(): RuntimeStatus {
  return {
    status: 'ready',
    version: RUNTIME_VERSION,
  };
}
