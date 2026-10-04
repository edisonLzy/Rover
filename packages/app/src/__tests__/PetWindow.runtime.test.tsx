// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PetWindow } from '../features/pet/index.js';

const runtime = vi.hoisted(() => ({
  events: undefined as
    | undefined
    | { onEvent: (event: unknown) => void; onStatusChange: (status: string) => void },
  accepted: undefined as undefined | ((data: { turnId: string }) => void),
  request: vi.fn(),
  invalidate: vi.fn(),
  connection: { ws_url: 'ws://test', token: 'test' },
  utils: undefined as unknown,
}));
vi.mock('../context/RuntimeContext.js', () => ({
  useRuntime: () => ({ connection: runtime.connection, loading: false, error: null }),
}));
vi.mock('../shared/preferences/pet.js', () => ({ usePetPreferences: () => ({ size: 75 }) }));
vi.mock('../utils/window.js', () => ({ isTauriEnvironment: () => false }));
vi.mock('../utils/websocket.js', () => ({
  RoverWebSocketClient: class {
    constructor(options: typeof runtime.events) {
      runtime.events = options;
    }
    connect() {
      runtime.events!.onStatusChange('connected');
    }
    disconnect() {}
  },
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
  await act(async () => runtime.events!.onEvent({ type, payload }));
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
