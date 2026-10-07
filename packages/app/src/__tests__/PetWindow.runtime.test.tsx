// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PetWindow } from '../features/pet/index.js';

const runtime = vi.hoisted(() => ({
  handlersList: [] as Array<Record<string, (payload: any, envelope?: any) => void>>,
  stateListeners: [] as Array<() => void>,
  accepted: undefined as undefined | ((data: { turnId: string }) => void),
  request: vi.fn(),
  invalidate: vi.fn(),
  queue: [] as Array<{ id: string; timestamp: number; promptDoc: any }>,
  clear: vi.fn(),
  connection: { ws_url: 'ws://test', token: 'test' },
  utils: undefined as unknown,
  wsStatus: 'connected',
  activeId: null as string | null,
  native: false,
  size: 75,
  setSize: vi.fn().mockResolvedValue(undefined),
  setPosition: vi.fn().mockResolvedValue(undefined),
}));

const mockWsClient = {
  getStatus: () => runtime.wsStatus,
  getState: () => runtime.wsStatus,
  subscribeState: (listener: () => void) => {
    runtime.stateListeners.push(listener);
    return () => {
      const idx = runtime.stateListeners.indexOf(listener);
      if (idx !== -1) runtime.stateListeners.splice(idx, 1);
    };
  },
  registerEventHandler: (handlers: Record<string, (payload: any) => void>) => {
    runtime.handlersList.push(handlers);
    return () => {
      const idx = runtime.handlersList.indexOf(handlers);
      if (idx !== -1) runtime.handlersList.splice(idx, 1);
    };
  },
};

vi.mock('../context/RuntimeContext.js', () => ({
  useRuntime: () => ({
    connection: runtime.connection,
    loading: false,
    error: null,
    wsClient: mockWsClient,
  }),
}));
vi.mock('../shared/preferences/pet.js', () => ({
  usePetPreferences: () => ({ size: runtime.size }),
}));
vi.mock('../utils/window.js', () => ({ isTauriEnvironment: () => runtime.native }));
vi.mock('@tauri-apps/api/window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/window')>()),
  getCurrentWindow: () => ({
    outerPosition: async () => ({ x: 1800, y: 1000 }),
    setSize: runtime.setSize,
    setPosition: runtime.setPosition,
  }),
  currentMonitor: async () => ({
    scaleFactor: 2,
    workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 1200 } },
  }),
}));
vi.mock('../utils/trpc.js', () => ({
  trpc: {
    useUtils: () => runtime.utils,
    health: { useQuery: () => ({ isSuccess: true }) },
    models: { getActive: { useQuery: () => ({ data: { hasActiveModel: true } }) } },
    tasks: {
      list: { useQuery: () => ({ data: [], isPending: false }) },
      openTerminal: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    turns: {
      clearAllQueues: { useMutation: () => ({ mutateAsync: runtime.clear }) },
      start: {
        useMutation: (options?: { onSuccess: typeof runtime.accepted }) => {
          if (options?.onSuccess) runtime.accepted = options.onSuccess;
          return { isPending: false, mutateAsync: runtime.request };
        },
      },
    },
  },
}));

let host: HTMLDivElement;
let root: Root;
let accept!: (result: { turnId: string }) => void;
beforeEach(async () => {
  runtime.wsStatus = 'connected';
  runtime.activeId = null;
  runtime.native = false;
  runtime.size = 75;
  runtime.setSize.mockClear();
  runtime.setPosition.mockClear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  runtime.handlersList.length = 0;
  runtime.stateListeners.length = 0;
  runtime.invalidate.mockReset();
  runtime.queue = [];
  let nextId = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `q${nextId++}` as ReturnType<typeof crypto.randomUUID>
  );
  runtime.clear.mockReset().mockImplementation(async () => {
    runtime.queue = [];
    return { success: true };
  });
  runtime.utils = {
    tasks: { list: { invalidate: runtime.invalidate } },
  };
  runtime.request.mockReset().mockImplementation(() =>
    new Promise<{ turnId: string }>((resolve) => {
      accept = resolve;
    }).then((data) => {
      runtime.accepted!(data);
      return data;
    })
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<PetWindow />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function submit(text = '运行请求') {
  await act(async () =>
    host
      .querySelector('[aria-label="Rover 宠物"]')!
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="编辑 Prompt"]')!.click()
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  await act(async () => {
    const textbox = host.querySelector('[role="textbox"]')!;
    textbox.querySelector('p')!.textContent = text;
    textbox.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () =>
    host
      .querySelector('[role="textbox"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  );
}
async function event(type: string, payload: Record<string, unknown>) {
  if (type === 'turn.started') runtime.activeId = payload.turnId as string;
  if (type === 'turn.end' && runtime.activeId === payload.turnId) runtime.activeId = null;
  await act(async () => {
    for (const handlers of runtime.handlersList) {
      if (handlers[type]) {
        handlers[type](payload);
      }
      if (handlers['*']) {
        handlers['*'](payload, { type, payload });
      }
    }
  });
}

describe('012 native popup layout', () => {
  it.each([60, 75, 100, 120])(
    'fits %s%% suggestions and clamps to the monitor work area',
    async (size) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        }
      );
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement
      ) {
        if (this.classList.contains('pet-shell')) return 175;
        if (this.classList.contains('pet-suggestions')) return 126;
        return 0;
      });
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
        this: HTMLElement
      ) {
        if (this.classList.contains('pet-composer')) return 115;
        if (this.classList.contains('pet-suggestion-popup')) return 68;
        return 0;
      });
      vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
        this: HTMLElement
      ) {
        if (this.classList.contains('pet-composer')) return host.querySelector('.pet-shell');
        if (this.classList.contains('pet-suggestion-popup'))
          return host.querySelector('.pet-composer');
        if (this.classList.contains('pet-suggestions')) return this.parentElement;
        return null;
      });
      // WebKit's zoomed viewport coordinates must not be applied a second time.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(900, 900, 1600, 1900)
      );
      runtime.native = true;
      runtime.size = size;
      await act(async () => root.render(<PetWindow />));
      const scale = size / 100;
      await vi.waitFor(() =>
        expect(runtime.setSize).toHaveBeenCalledWith(
          expect.objectContaining({ width: Math.ceil(556 * scale), height: Math.ceil(253 * scale) })
        )
      );
      const popup = document.createElement('div');
      popup.className = 'pet-suggestion-popup';
      const panel = document.createElement('div');
      panel.className = 'pet-suggestions';
      popup.append(panel);
      host.querySelector('.pet-composer')!.append(popup);
      const height = Math.ceil(379 * scale);
      await vi.waitFor(() =>
        expect(runtime.setSize).toHaveBeenLastCalledWith(
          expect.objectContaining({ width: Math.ceil(556 * scale), height })
        )
      );
      expect(runtime.setPosition).toHaveBeenLastCalledWith(
        expect.objectContaining({ x: 2000 - Math.ceil(556 * scale) * 2, y: 1200 - height * 2 })
      );
      expect(popup.style.left).toBe('');
      popup.remove();
      await vi.waitFor(() =>
        expect(runtime.setSize).toHaveBeenLastCalledWith(
          expect.objectContaining({ height: Math.ceil(253 * scale) })
        )
      );
    }
  );
});

describe('012 preserves Runtime streaming during composer migration', () => {
  it('does not overwrite streamed output with a late HTTP receipt', async () => {
    await submit();
    expect(runtime.request).toHaveBeenCalledTimes(1);
    await event('turn.started', { turnId: 'turn-1' });
    await event('turn.delta', { turnId: 'turn-1', accumulated: '真实回复', isThinking: false });
    await act(async () => accept({ turnId: 'turn-1' }));
    expect(host.querySelector('.pet-speech')!.textContent).toContain('真实回复');
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('');
  });
  it('preserves output if the turn ends before HTTP acceptance', async () => {
    await submit();
    await event('turn.started', { turnId: 'turn-1' });
    await event('turn.delta', { turnId: 'turn-1', accumulated: '已经完成', isThinking: false });
    await event('turn.end', { turnId: 'turn-1', status: 'completed' });
    await act(async () => accept({ turnId: 'turn-1' }));
    expect(host.querySelector('.pet-speech')!.textContent).toContain('已经完成');
    expect(host.querySelector('.speech-spinner')).toBeNull();
  });
  it('refreshes the shared Task query when task.changed arrives', async () => {
    await event('task.changed', { taskId: 'task-1', status: 'running' });
    expect(runtime.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe('015 PetBubble output isolation & turn lifecycle', () => {
  it('does not overwrite PetBubble output when task.changed arrives with needs_intervention', async () => {
    await event('turn.started', { turnId: 'turn-1' });
    await event('turn.delta', {
      turnId: 'turn-1',
      accumulated: '深度模型回复中...',
      isThinking: false,
    });
    expect(host.querySelector('.pet-speech')!.textContent).toContain('深度模型回复中...');

    // Task event arrives with needs_intervention
    await event('task.changed', { taskId: 'task-1', status: 'needs_intervention' });
    expect(runtime.invalidate).toHaveBeenCalledTimes(1);

    // PetBubble text MUST remain intact and not be overwritten by task intervention text
    expect(host.querySelector('.pet-speech')!.textContent).toContain('深度模型回复中...');
    expect(host.querySelector('.pet-speech')!.textContent).not.toContain('需要你确认');
  });

  it('ignores stale turn deltas from a previous turn', async () => {
    await event('turn.started', { turnId: 'turn-1' });
    await event('turn.delta', { turnId: 'turn-1', accumulated: '第一轮回复', isThinking: false });
    await event('turn.end', { turnId: 'turn-1', status: 'completed' });

    // Second turn starts
    await event('turn.started', { turnId: 'turn-2' });
    expect(host.querySelector('.pet-speech')!.textContent).toContain('思考中…');

    // Late arriving delta from turn-1
    await event('turn.delta', {
      turnId: 'turn-1',
      accumulated: '迟到的第一轮内容',
      isThinking: false,
    });
    expect(host.querySelector('.pet-speech')!.textContent).not.toContain('迟到的第一轮内容');

    // Current turn delta arrives
    await event('turn.delta', { turnId: 'turn-2', accumulated: '第二轮回复', isThinking: false });
    expect(host.querySelector('.pet-speech')!.textContent).toContain('第二轮回复');
  });
});

async function addQueuedInputs() {
  await event('turn.started', { turnId: 'current' });
  for (let index = 0; index < 3; index++) await submit(`待办 ${index}`);
}

describe('016 queue synchronization and handoff', () => {
  it('enqueues a busy draft into the bubble and keeps the toolbar free of vertical pending lists', async () => {
    await event('turn.started', { turnId: 'current' });
    await submit();
    expect(runtime.request).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="接续队列"]')!.textContent).toContain('运行请求');
    expect(host.querySelector('[aria-label="待处理 Prompt"]')).toBeNull();
  });
  it('deletes badge locally and updates badge shelf immediately', async () => {
    await addQueuedInputs();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="删除待办：待办 1"]')!.click()
    );
    expect(host.querySelector('[aria-label="接续队列"]')!.textContent).not.toContain('待办 1');
    expect(host.querySelector('[data-follow-up-id="q0"]')).not.toBeNull();
    expect(host.querySelector('[data-follow-up-id="q2"]')).not.toBeNull();
  });
  it('shows a handoff failure when starting follow-up fails', async () => {
    await addQueuedInputs();
    runtime.request.mockRejectedValueOnce(new Error('网络异常'));
    vi.useFakeTimers();
    await event('turn.end', { turnId: 'current', status: 'completed' });
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('网络异常');
  });
  it('waits 1.5 seconds after turn.end and evicts only the consumed ID after actual turn start', async () => {
    await addQueuedInputs();
    vi.useFakeTimers();
    await event('turn.end', { turnId: 'current', status: 'completed' });
    expect(host.querySelector('[data-follow-up-id="q0"]')!.className).toContain('bg-[#e3edff]');
    await act(async () => vi.advanceTimersByTimeAsync(1499));
    expect(runtime.request).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-follow-up-id="q0"]')).not.toBeNull();
    await act(async () => accept({ turnId: 'follow-up-turn' }));
    expect(host.querySelector('[data-follow-up-id="q0"]')).toBeNull();
    expect(host.querySelector('[data-follow-up-id="q1"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(runtime.request).toHaveBeenCalledTimes(1);
  });
  it('allows a click to skip the wait without evicting before turn start', async () => {
    await addQueuedInputs();
    vi.useFakeTimers();
    await event('turn.end', { turnId: 'current', status: 'completed' });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="立即执行：待办 0"]')!.click()
    );
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-follow-up-id="q0"]')).not.toBeNull();
    await act(async () => accept({ turnId: 'follow-up-turn' }));
    expect(host.querySelector('[data-follow-up-id="q0"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(runtime.request).toHaveBeenCalledTimes(1);
  });
  it('reorders badges with the real keyboard drag sensor and updates DOM order', async () => {
    await addQueuedInputs();
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const id = this.closest('[data-follow-up-id]')?.getAttribute('data-follow-up-id');
      return new DOMRect(id === 'q1' ? 110 : 0, 0, 100, 22);
    });
    const grip = host.querySelector<HTMLButtonElement>('[aria-label="拖动排序：待办 0"]')!;
    await act(async () => {
      grip.focus();
      grip.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(30));
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true })
      )
    );
    await act(async () => vi.advanceTimersByTimeAsync(30));
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })
      )
    );
    const badgeIds = [...host.querySelectorAll('[data-follow-up-id]')].map((el) =>
      el.getAttribute('data-follow-up-id')
    );
    expect(badgeIds).toEqual(['q1', 'q0', 'q2']);
  });
});
