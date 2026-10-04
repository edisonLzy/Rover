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
  connection: { ws_url: 'ws://test', token: 'test' },
  utils: undefined as unknown,
}));

const mockWsClient = {
  getStatus: () => 'connected',
  getState: () => 'connected',
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
vi.mock('../shared/preferences/pet.js', () => ({ usePetPreferences: () => ({ size: 75 }) }));
vi.mock('../utils/window.js', () => ({ isTauriEnvironment: () => false }));
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
      start: {
        useMutation: (options: { onSuccess: typeof runtime.accepted }) => {
          runtime.accepted = options.onSuccess;
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
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  runtime.handlersList.length = 0;
  runtime.stateListeners.length = 0;
  runtime.invalidate.mockReset();
  runtime.utils = { tasks: { list: { invalidate: runtime.invalidate } } };
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
});
async function submit() {
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
    textbox.querySelector('p')!.textContent = '运行请求';
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
