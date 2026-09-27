import { describe, expect, it, afterEach } from 'vitest';
import { isTauriEnvironment, resolveInitialWindowLabel } from '../utils/window';

describe('Dual-Window Label Resolution', () => {
  afterEach(() => {
    // Clean up simulated window
    delete (globalThis as unknown as { window?: unknown }).window;
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

  it('detects Tauri environment when __TAURI_INTERNALS__ is present', () => {
    (globalThis as unknown as { window?: Record<string, unknown> }).window = {
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'main' },
        },
      },
    };
    expect(isTauriEnvironment()).toBe(true);
  });
});
