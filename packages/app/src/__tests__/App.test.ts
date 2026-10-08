import { describe, expect, it, afterEach, vi } from 'vitest';
import { isTauriEnvironment, resolveInitialWindowLabel } from '../utils/window';

describe('Dual-Window Label Resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects non-Tauri environment correctly', () => {
    expect(isTauriEnvironment()).toBe(false);
  });

  it('falls back to default "dashboard" when no query param exists', () => {
    expect(resolveInitialWindowLabel('')).toBe('dashboard');
  });

  it('resolves "main" window label from search query', () => {
    expect(resolveInitialWindowLabel('?window=main')).toBe('main');
  });

  it('resolves "dashboard" window label from search query', () => {
    expect(resolveInitialWindowLabel('?window=dashboard')).toBe('dashboard');
  });

  it('uses the native window label when the official API detects Tauri', () => {
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'main' },
        },
      },
    });
    expect(isTauriEnvironment()).toBe(true);
    expect(resolveInitialWindowLabel('?window=dashboard')).toBe('main');
  });

  it('does not treat the internal bridge alone as an environment marker', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isTauriEnvironment()).toBe(false);
    expect(resolveInitialWindowLabel('?window=dashboard')).toBe('dashboard');
  });
});
