// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpShelf } from '../features/pet/AgentPanel/FollowUpShelf.js';
import type { useFollowUps, FollowUpItem } from '../features/pet/useFollowUps.js';

const items: FollowUpItem[] = ['一', '二', '三', '四'].map((text, index) => ({
  id: `q${index}`,
  timestamp: 42,
  promptDoc: { v: 1, parts: [{ type: 'text', text }] },
}));
const queue = (entries: FollowUpItem[] = items) =>
  ({
    items: entries,
    syncing: false,
    startingId: null,
    error: null,
    canAdvance: true,
    highlightedId: entries[0]?.id,
    enqueue: vi.fn(),
    advance: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
  }) as ReturnType<typeof useFollowUps>;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function shelf(props: ReturnType<typeof useFollowUps>) {
  await act(async () =>
    root.render(
      <FollowUpShelf
        items={props.items}
        highlightedId={props.highlightedId}
        onRemove={props.remove}
        onReorder={props.reorder}
        onAdvance={props.advance}
        canAdvance={props.canAdvance}
      />
    )
  );
}
async function tick(time: number) {
  await act(async () => vi.advanceTimersByTimeAsync(time));
}

describe('Agent Panel Follow-Up shelf', () => {
  it.each([1, 2, 4])(
    'renders %s entries in a single horizontal viewport with delete and immediate start',
    async (count) => {
      const props = queue(items.slice(0, count));
      await shelf(props);
      expect(host.querySelectorAll('.follow-up-pill')).toHaveLength(count);
      expect(host.querySelectorAll('[role="list"]')).toHaveLength(1);
      const row = host.querySelector<HTMLElement>('[aria-label="横向滚动待办"]')!;
      expect(row.classList.contains('overflow-x-auto')).toBe(true);
      expect(row.classList.contains('h-[22px]')).toBe(true);
      expect(host.querySelector('[aria-expanded]')).toBeNull();
      expect(host.textContent).not.toContain('+2');
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="立即执行：一"]')!.click()
      );
      expect(props.advance).toHaveBeenCalledWith('q0');
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="删除待办：一"]')!.click()
      );
      expect(props.remove).toHaveBeenCalledWith('q0');
    }
  );
  it('scrolls additional badges with the mouse wheel and keyboard without expanding the shelf', async () => {
    await shelf(queue());
    const row = host.querySelector<HTMLElement>('[aria-label="横向滚动待办"]')!;
    Object.defineProperties(row, {
      clientWidth: { value: 200 },
      scrollWidth: { value: 404 },
    });
    const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    await act(async () => row.dispatchEvent(wheel));
    expect(row.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
    await act(async () =>
      row.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, bubbles: true, cancelable: true }))
    );
    expect(row.scrollLeft).toBe(204);
    await act(async () =>
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    );
    expect(row.scrollLeft).toBe(102);
    const moreWheel = new WheelEvent('wheel', { deltaX: 60, bubbles: true, cancelable: true });
    await act(async () => row.dispatchEvent(moreWheel));
    expect(moreWheel.defaultPrevented).toBe(false);
    const grip = host.querySelector('[aria-label="拖动排序：一"]')!;
    await act(async () =>
      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    );
    expect(row.scrollLeft).toBe(102);
    expect(host.querySelectorAll('[role="list"]')).toHaveLength(1);
  });
  it.each([0.6, 0.75, 1, 1.2])(
    'reorders at scale %s via the dnd-kit keyboard sensor using Space and ArrowRight',
    async (scale) => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement
      ) {
        const pill = this.closest('[data-follow-up-id]');
        return new DOMRect(
          pill?.getAttribute('data-follow-up-id') === 'q1' ? 110 * scale : 0,
          0,
          100 * scale,
          22 * scale
        );
      });
      const onReorder = vi.fn();
      await act(async () =>
        root.render(
          <FollowUpShelf
            scale={scale}
            items={items.slice(0, 2)}
            onRemove={vi.fn()}
            onAdvance={vi.fn()}
            onReorder={onReorder}
          />
        )
      );
      const grip = host.querySelector<HTMLButtonElement>('[aria-label="拖动排序：一"]')!;
      await act(async () => grip.focus());
      await act(async () =>
        grip.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
      );
      await tick(30);
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true })
        )
      );
      await tick(30);
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
        )
      );
      expect(onReorder).toHaveBeenCalledWith(['q1', 'q0']);
      onReorder.mockClear();
      await act(async () =>
        grip.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
      );
      await tick(30);
      await act(async () =>
        grip.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
        )
      );
      expect(onReorder).not.toHaveBeenCalled();
      expect(grip.getAttribute('aria-pressed')).not.toBe('true');
    }
  );
});
