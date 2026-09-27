/**
 * Unified Session Carrier abstraction.
 *
 * Decouples Code Agent process detachment and TTY management from the underlying OS mechanisms:
 * - macOS / Linux: GNU Screen (`/usr/bin/screen`)
 * - Windows: ConPTY (PseudoConsole API) / Named Pipes / CLI Daemon mode (TODO)
 */

import process from 'node:process';
import {
  getScreenSessionInfo,
  killScreenSession,
  listRoverScreenSessions,
  type ScreenSessionInfo,
  startScreenSession,
} from './screen.js';

export type SessionCarrierType = 'screen' | 'conpty' | 'daemon';

export type CarrierSessionStatus = 'detached' | 'attached' | 'dead' | 'unknown';

export interface CarrierSessionInfo {
  attemptId: string;
  sessionName: string;
  pid: number | null;
  status: CarrierSessionStatus;
  carrierType: SessionCarrierType;
}

export interface StartCarrierSessionOptions {
  attemptId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  reportToken?: string;
}

export interface SessionCarrier {
  readonly carrierType: SessionCarrierType;
  startSession(options: StartCarrierSessionOptions): Promise<CarrierSessionInfo>;
  getSessionInfo(attemptId: string): Promise<CarrierSessionInfo | null>;
  listSessions(): Promise<CarrierSessionInfo[]>;
  killSession(attemptId: string): Promise<boolean>;
}

/**
 * ScreenSessionCarrier: POSIX / macOS carrier based on system GNU Screen (/usr/bin/screen).
 */
export class ScreenSessionCarrier implements SessionCarrier {
  readonly carrierType: SessionCarrierType = 'screen';

  constructor(private readonly screenBinary: string = '/usr/bin/screen') {}

  async startSession(options: StartCarrierSessionOptions): Promise<CarrierSessionInfo> {
    const raw = await startScreenSession({
      ...options,
      screenBinary: this.screenBinary,
    });
    return this.mapToCarrierSession(raw);
  }

  async getSessionInfo(attemptId: string): Promise<CarrierSessionInfo | null> {
    const raw = await getScreenSessionInfo(attemptId, this.screenBinary);
    return raw ? this.mapToCarrierSession(raw) : null;
  }

  async listSessions(): Promise<CarrierSessionInfo[]> {
    const rawList = await listRoverScreenSessions(this.screenBinary);
    return rawList.map((s) => this.mapToCarrierSession(s));
  }

  async killSession(attemptId: string): Promise<boolean> {
    return killScreenSession(attemptId, this.screenBinary);
  }

  private mapToCarrierSession(info: ScreenSessionInfo): CarrierSessionInfo {
    return {
      attemptId: info.attemptId,
      sessionName: info.sessionName,
      pid: info.pid,
      status: info.status,
      carrierType: this.carrierType,
    };
  }
}

/**
 * WindowsSessionCarrier: Windows implementation placeholder with ConPTY / Named Pipe roadmap.
 *
 * TODO(windows): Complete native Windows ConPTY terminal carrier implementation.
 *
 * Architectural Blueprint for Windows:
 * 1. Background PseudoConsole (ConPTY):
 *    - Windows 10 (1809+) & Windows 11 provide `CreatePseudoConsole`.
 *    - The host process (Tauri Rust / helper) creates a ConPTY instance and runs the Code Agent CLI
 *      inside it with standard I/O piped to an asynchronous Named Pipe (`\\\\.\\pipe\\rover_<attempt_id>`).
 * 2. Attachment / UI Reconnection:
 *    - When the user clicks "View Session" / "Go to Confirm" in the Rover UI:
 *      Launch Windows Terminal (`wt.exe`) or a custom ConPTY client attached to that Named Pipe.
 * 3. CLI Daemon Alternative:
 *    - As an alternative to ConPTY multiplexing, modern CLIs support daemon modes:
 *      e.g. `codex app-server` or Claude background agent view, communicating over WebSocket/RPC.
 */
export class WindowsSessionCarrier implements SessionCarrier {
  readonly carrierType: SessionCarrierType = 'conpty';

  async startSession(options: StartCarrierSessionOptions): Promise<CarrierSessionInfo> {
    // TODO(windows): Connect with Rust host or Win32 ConPTY daemon to spawn detached process
    throw new Error(
      `[WindowsSessionCarrier] GNU Screen is not supported on Windows. ` +
        `Attempt "${options.attemptId}" requires Windows ConPTY / Named Pipe carrier, which is planned for post-MVP. ` +
        `See packages/runtime/src/dispatch/carrier.ts for the Windows architecture blueprint.`
    );
  }

  async getSessionInfo(_attemptId: string): Promise<CarrierSessionInfo | null> {
    // TODO(windows): Query Windows ConPTY active pipe or process table
    return null;
  }

  async listSessions(): Promise<CarrierSessionInfo[]> {
    // TODO(windows): Enumerate active Rover named pipes
    return [];
  }

  async killSession(_attemptId: string): Promise<boolean> {
    // TODO(windows): Terminate ConPTY process tree
    return false;
  }
}

/**
 * Factory function returning the appropriate SessionCarrier for the current OS.
 */
export function getSessionCarrier(platform: NodeJS.Platform = process.platform): SessionCarrier {
  if (platform === 'win32') {
    return new WindowsSessionCarrier();
  }
  return new ScreenSessionCarrier();
}
