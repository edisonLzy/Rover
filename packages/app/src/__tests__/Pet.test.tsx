// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Pet } from '../features/pet/Pet/index.js';

const native = vi.hoisted(() => ({
  drag: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/window.js', () => ({ isTauriEnvironment: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: native.drag }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  native.drag.mockClear();
  native.invoke.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Pet onHoverChange={vi.fn()} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function menu() {
  await act(async () =>
    host
      .querySelector('button')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  );
}

describe('012 Pet native interactions', () => {
  it('only opens Dashboard and closes the context menu after success', async () => {
    await menu();
    const item = host.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
    expect(document.activeElement).toBe(item);
    await act(async () => item.click());
    expect(native.invoke).toHaveBeenCalledWith('show_window', { label: 'dashboard' });
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  it('dismisses the menu with Escape or an outside pointer', async () => {
    await menu();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await menu();
    await act(async () =>
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    );
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  it('keeps a failed Dashboard action visible with its error', async () => {
    native.invoke.mockRejectedValueOnce(new Error('打开失败'));
    await menu();
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('打开失败');
  });
  it('starts native dragging once after the movement threshold', async () => {
    const button = host.querySelector('button')!;
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 10,
          clientY: 10,
        })
      );
      button.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 12, clientY: 11 })
      );
    });
    expect(native.drag).not.toHaveBeenCalled();
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 20, clientY: 20 })
      );
      button.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 30, clientY: 30 })
      );
    });
    expect(native.drag).toHaveBeenCalledTimes(1);
  });
});
