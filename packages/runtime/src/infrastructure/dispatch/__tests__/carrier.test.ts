import { describe, expect, it } from 'vitest';
import { getSessionCarrier, ScreenSessionCarrier, WindowsSessionCarrier } from '../carrier.js';

describe('carrier module unit tests', () => {
  it('returns ScreenSessionCarrier on darwin and linux', () => {
    const darwinCarrier = getSessionCarrier('darwin');
    expect(darwinCarrier).toBeInstanceOf(ScreenSessionCarrier);
    expect(darwinCarrier.carrierType).toBe('screen');

    const linuxCarrier = getSessionCarrier('linux');
    expect(linuxCarrier).toBeInstanceOf(ScreenSessionCarrier);
    expect(linuxCarrier.carrierType).toBe('screen');
  });

  it('returns WindowsSessionCarrier on win32', () => {
    const winCarrier = getSessionCarrier('win32');
    expect(winCarrier).toBeInstanceOf(WindowsSessionCarrier);
    expect(winCarrier.carrierType).toBe('conpty');
  });

  it('WindowsSessionCarrier provides structured error and placeholder roadmap', async () => {
    const winCarrier = new WindowsSessionCarrier();

    await expect(
      winCarrier.startSession({
        attemptId: 'win_test_1',
        command: 'codex.cmd',
      })
    ).rejects.toThrow(/Windows ConPTY \/ Named Pipe carrier/);

    expect(await winCarrier.getSessionInfo('win_test_1')).toBeNull();
    expect(await winCarrier.listSessions()).toEqual([]);
    expect(await winCarrier.killSession('win_test_1')).toBe(false);
  });
});
