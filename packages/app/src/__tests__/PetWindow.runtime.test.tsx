// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PetWindow } from '../features/pet/index.js';

const state = vi.hoisted(() => ({
  handlers: [] as Array<Record<string, (payload: any) => void>>,
  listeners: [] as Array<() => void>,
  request: vi.fn(),
  invalidate: vi.fn(),
  refresh: vi.fn(),
  delegated: vi.fn(),
  resolve: vi.fn(),
  feed: [] as any[],
  latest: [] as any[],
  pending: [] as any[],
  tasks: [] as any[],
  inbox: [] as any[],
  status: 'connected',
  native: false,
  size: 75,
  position: { x: 600, y: 200 },
  setSize: vi.fn(),
  setPosition: vi.fn(),
}));
const wsClient = {
  getStatus: () => state.status,
  subscribeState: (listener: () => void) => {
    state.listeners.push(listener);
    return () => {
      state.listeners.splice(state.listeners.indexOf(listener), 1);
    };
  },
  registerEventHandler: (handlers: Record<string, (payload: any) => void>) => {
    state.handlers.push(handlers);
    return () => {
      state.handlers.splice(state.handlers.indexOf(handlers), 1);
    };
  },
};
vi.mock('../context/RuntimeContext.js', () => ({
  useRuntime: () => ({ connection: {}, loading: false, error: null, wsClient }),
}));
vi.mock('../shared/preferences/pet.js', () => ({
  usePetPreferences: () => ({ size: state.size }),
}));
vi.mock('../utils/window.js', () => ({ isTauriEnvironment: () => state.native }));
vi.mock('@tauri-apps/api/window', async (original) => ({
  ...(await original<typeof import('@tauri-apps/api/window')>()),
  getCurrentWindow: () => ({
    outerPosition: async () => state.position,
    setSize: state.setSize,
    setPosition: state.setPosition,
    startDragging: vi.fn(),
    onMoved: async () => () => {},
    onScaleChanged: async () => () => {},
  }),
  currentMonitor: async () => ({
    scaleFactor: 2,
    workArea: { position: { x: 0, y: 0 }, size: { width: 2400, height: 1600 } },
  }),
}));
const utils = {
  tasks: { list: { invalidate: state.invalidate } },
  inbox: {
    list: { invalidate: state.invalidate },
    getUnreadCount: { invalidate: state.invalidate },
  },
  history: { getFeed: { fetch: vi.fn() } },
};
vi.mock('../utils/trpc.js', () => ({
  trpc: {
    useUtils: () => utils,
    health: { useQuery: () => ({ isSuccess: true }) },
    models: { getActive: { useQuery: () => ({ data: { hasActiveModel: true } }) } },
    history: {
      getFeed: { useQuery: () => ({ data: state.feed, isPending: false, refetch: state.refresh }) },
      listTurns: { useQuery: () => ({ data: state.latest }) },
    },
    permissions: {
      getPendingRequests: { useQuery: () => ({ data: state.pending, refetch: state.refresh }) },
      resolve: { useMutation: () => ({ mutateAsync: state.resolve }) },
    },
    tasks: {
      list: {
        useQuery: (input?: { status?: string }) => ({
          data: input?.status
            ? state.tasks.filter((task) => task.status === input.status)
            : state.tasks,
          isPending: false,
        }),
      },
      openTerminal: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    inbox: {
      list: { useQuery: () => ({ data: state.inbox, isPending: false }) },
      getUnreadCount: { useQuery: () => ({ data: state.inbox.length }) },
      markAsDelegated: { useMutation: () => ({ mutateAsync: state.delegated }) },
    },
    turns: {
      start: {
        useMutation: (options?: { onSuccess?: (result: { turnId: string }) => void }) => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            const result = await state.request(input);
            options?.onSuccess?.(result);
            return result;
          },
        }),
      },
    },
  },
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  state.handlers = [];
  state.listeners = [];
  state.feed = [];
  state.latest = [];
  state.pending = [];
  state.tasks = [];
  state.inbox = [];
  state.status = 'connected';
  state.native = false;
  state.size = 75;
  state.position = { x: 600, y: 200 };
  state.setSize.mockReset().mockResolvedValue(undefined);
  state.setPosition.mockReset().mockImplementation(async (position) => {
    state.position = position;
  });
  state.request.mockReset().mockResolvedValue({ turnId: 'turn-1' });
  state.refresh.mockReset().mockResolvedValue({});
  state.invalidate.mockReset();
  state.delegated.mockReset().mockResolvedValue({ success: true });
  state.resolve.mockReset().mockResolvedValue({ success: true });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mount() {
  await act(async () => root.render(<PetWindow />));
}
async function click(selector: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
}
async function toggle() {
  await click('.pet-avatar');
}
async function type(text: string) {
  await act(async () => {
    const textbox = host.querySelector('[role="textbox"]')!;
    textbox.querySelector('p')!.textContent = text;
    textbox.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function send() {
  await act(async () =>
    host
      .querySelector('[role="textbox"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  );
}
async function emit(type: string, payload: any) {
  await act(async () => state.handlers.forEach((handlers) => handlers[type]?.(payload)));
}

describe('Pet Agent Panel continuity', () => {
  it('starts collapsed, retains draft and tab, and returns keyboard focus to the avatar', async () => {
    await mount();
    expect(host.querySelector<HTMLElement>('.agent-panel')!.hidden).toBe(true);
    await toggle();
    await type('明天继续');
    await click('#panel-tab-task');
    await toggle();
    await toggle();
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('明天继续');
    expect(host.querySelector('#panel-tab-task')!.getAttribute('aria-selected')).toBe('true');
    await act(async () =>
      host
        .querySelector('.pet-window')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    expect(host.querySelector<HTMLElement>('.agent-panel')!.hidden).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('.pet-avatar'));
  });
  it('cancels delayed editor focus when Escape collapses the panel', async () => {
    await mount();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    await toggle();
    await act(async () =>
      host
        .querySelector('.pet-window')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(document.activeElement).toBe(host.querySelector('.pet-avatar'));
  });
  it('keeps subscriptions and output while collapsed, even when HTTP acceptance arrives late', async () => {
    let accept!: (result: { turnId: string }) => void;
    state.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    await mount();
    await toggle();
    await type('运行请求');
    await send();
    const count = state.handlers.length;
    await emit('turn.started', { turnId: 'turn-1' });
    await toggle();
    await emit('turn.delta', { turnId: 'turn-1', accumulated: '完整回答' });
    await emit('turn.end', { turnId: 'turn-1', status: 'completed' });
    await act(async () => accept({ turnId: 'turn-1' }));
    await toggle();
    expect(state.handlers).toHaveLength(count);
    expect(host.querySelector('.chat-messages')!.textContent).toContain('完整回答');
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('idle');
  });
  it('shows running Tasks after the Rover turn ends and gives intervention priority', async () => {
    state.tasks = [
      {
        id: 'task-1',
        goal: '后台构建',
        agent: 'codex',
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    await mount();
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('running');
    await emit('turn.started', { turnId: 'turn-1' });
    await emit('turn.end', { turnId: 'turn-1', status: 'completed' });
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('running');
    state.tasks = [{ ...state.tasks[0], status: 'needs_intervention' }];
    await mount();
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('attention');
    await emit('task.changed', {});
    expect(state.invalidate).toHaveBeenCalled();
  });
  it('restores busy state from an active persisted Rover turn', async () => {
    state.latest = [{ id: 'ongoing', status: 'running' }];
    await mount();
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('running');
    await toggle();
    await type('稍后执行');
    await send();
    expect(state.request).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.follow-up-pill')).toHaveLength(1);
  });
  it('recovers from a missed turn.end after reconnecting', async () => {
    state.latest = [{ id: 'ongoing', status: 'running' }];
    await mount();
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('running');
    state.latest = [{ id: 'ongoing', status: 'completed' }];
    await mount();
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('idle');
    expect(host.querySelector('.processing-card')).toBeNull();
  });
  it('starts a follow-up only once when clicked twice before rerendering', async () => {
    await mount();
    await toggle();
    await emit('turn.started', { turnId: 'turn-1' });
    await type('后续输入');
    await send();
    await emit('turn.end', { turnId: 'turn-1', status: 'completed' });
    let accept!: (result: { turnId: string }) => void;
    state.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    await act(async () => {
      const button = host.querySelector<HTMLButtonElement>('[aria-label="立即执行：后续输入"]')!;
      button.click();
      button.click();
    });
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.follow-up-pill')).toHaveLength(1);
    await act(async () => accept({ turnId: 'follow-up-turn' }));
    expect(host.querySelectorAll('.follow-up-pill')).toHaveLength(0);
  });
  it('preserves approval on collapse and uses the avatar attention state', async () => {
    await mount();
    await emit('permission.requested', {
      turnId: 'turn-1',
      requestId: 'req',
      payload: { kind: 'permission', toolName: 'bash', command: 'rm -rf dist', tier: 3 },
    });
    expect(host.querySelector('.pet-avatar')!.getAttribute('data-activity')).toBe('attention');
    await toggle();
    await toggle();
    expect(state.resolve).not.toHaveBeenCalled();
    await toggle();
    await click('[aria-label="拒绝"]');
    expect(state.resolve).toHaveBeenCalledWith({ requestId: 'req', approved: false });
  });
  it('keeps follow-up handoff running after collapse and waits for acceptance', async () => {
    await mount();
    await toggle();
    await emit('turn.started', { turnId: 'turn-1' });
    await type('接着运行');
    await send();
    expect(host.querySelectorAll('.follow-up-pill')).toHaveLength(1);
    await toggle();
    vi.useFakeTimers();
    await emit('turn.end', { turnId: 'turn-1', status: 'completed' });
    await act(async () => vi.advanceTimersByTimeAsync(1499));
    expect(state.request).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.follow-up-pill')).toHaveLength(0);
  });
});

describe('Native panel sizing and avatar anchor', () => {
  it.each([60, 75, 100, 120])('fits expanded and collapsed windows at %s%%', async (size) => {
    state.native = true;
    state.size = size;
    state.position = { x: 2100, y: 1400 };
    await mount();
    const scale = size / 100;
    expect(state.setSize).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: Math.ceil(96 * scale), height: Math.ceil(96 * scale) })
    );
    await toggle();
    const dimensions = state.setSize.mock.calls.at(-1)![0];
    expect(dimensions.width * 2).toBeLessThanOrEqual(2400);
    expect(dimensions.height * 2).toBeLessThanOrEqual(1600);
    expect(state.position.x).toBeGreaterThanOrEqual(0);
    expect(state.position.y).toBeGreaterThanOrEqual(0);
    expect(state.position.x + dimensions.width * 2).toBeLessThanOrEqual(2400);
    expect(state.position.y + dimensions.height * 2).toBeLessThanOrEqual(1600);
    await toggle();
    expect(state.setSize).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: Math.ceil(96 * scale), height: Math.ceil(96 * scale) })
    );
  });
  it('keeps the avatar at the same screen position when there is room to expand', async () => {
    state.native = true;
    state.position = { x: 1000, y: 200 };
    await mount();
    const before = { ...state.position };
    const oldCenter = { x: before.x + 48 * 0.75 * 2, y: before.y + 48 * 0.75 * 2 };
    await toggle();
    expect(state.position.x + 390 * 0.75 * 2).toBe(oldCenter.x);
    expect(state.position.y + 50 * 0.75 * 2).toBe(oldCenter.y);
    await toggle();
    expect(state.position.x).toBe(before.x);
    expect(state.position.y).toBe(before.y);
  });
});
