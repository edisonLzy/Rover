// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat, useConversation } from '../features/pet/AgentPanel/Chat/index.js';
import type { HistoryEntry } from '../features/pet/AgentPanel/Chat/types.js';

const state = vi.hoisted(() => ({
  handlers: [] as Array<Record<string, (payload: any) => void>>,
  feed: [] as HistoryEntry[],
  pending: [] as any[],
  pendingAt: 0,
  older: vi.fn(),
  resolve: vi.fn(),
  refresh: vi.fn(),
}));
const wsClient = {
  registerEventHandler: (handlers: Record<string, (payload: any) => void>) => {
    state.handlers.push(handlers);
    return () => {
      state.handlers.splice(state.handlers.indexOf(handlers), 1);
    };
  },
  subscribeState: () => () => {},
  getStatus: () => 'connected',
};
vi.mock('../context/RuntimeContext.js', () => ({
  useRuntime: () => ({ connection: {}, wsClient }),
}));
vi.mock('../utils/trpc.js', () => ({
  trpc: {
    useUtils: () => ({ history: { getFeed: { fetch: state.older } } }),
    history: {
      getFeed: {
        useQuery: () => ({
          data: state.feed,
          isPending: false,
          error: null,
          refetch: state.refresh,
        }),
      },
    },
    permissions: {
      getPendingRequests: {
        useQuery: () => ({
          data: state.pending,
          dataUpdatedAt: state.pendingAt,
          refetch: state.refresh,
        }),
      },
      resolve: { useMutation: () => ({ mutateAsync: state.resolve }) },
    },
  },
}));
let host: HTMLDivElement;
let root: Root;
function Harness({ hidden = false, turnId = null }: { hidden?: boolean; turnId?: string | null }) {
  const conversation = useConversation(turnId);
  return (
    <div hidden={hidden}>
      <Chat conversation={conversation} search="" />
    </div>
  );
}
const entry = (seq: number, text: string, role = 'assistant', turnId = 'turn-1'): HistoryEntry => ({
  id: `entry-${seq}`,
  seq,
  turnId,
  type: 'message',
  data: { role, content: [{ type: 'text', text }] },
  createdAt: seq,
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.handlers = [];
  state.feed = [];
  state.pending = [];
  state.pendingAt = 0;
  state.older.mockReset().mockResolvedValue([]);
  state.refresh.mockReset().mockResolvedValue({});
  state.resolve.mockReset().mockResolvedValue({ success: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function render(hidden = false) {
  await act(async () => root.render(<Harness hidden={hidden} />));
}
async function emit(type: string, payload: any) {
  await act(async () => {
    state.handlers.forEach((handler) => handler[type]?.(payload));
  });
}
async function request(id = 'request-1', kind = 'permission') {
  await emit('permission.requested', {
    turnId: 'turn-1',
    requestId: id,
    payload:
      kind === 'workspace_access'
        ? { kind, toolName: 'bash', targetPath: '/external/repo', resolvedPath: '/external/repo' }
        : { kind, toolName: 'bash', command: 'rm -rf ./dist', tier: 3 },
  });
}
async function click(label: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}

describe('Chat history and live continuity', () => {
  it('restores saved dialogue while omitting tool payloads and compaction', async () => {
    state.feed = [
      entry(1, '问题', 'user'),
      entry(2, '回答'),
      entry(3, 'raw tool', 'toolResult'),
      { ...entry(4, 'memory'), type: 'compaction' },
    ];
    await render();
    expect(host.querySelectorAll('.chat-message')).toHaveLength(2);
    expect(host.textContent).toContain('问题');
    expect(host.textContent).not.toContain('raw tool');
    expect(host.textContent).not.toContain('memory');
  });
  it('continues streaming while hidden and deduplicates the persisted answer', async () => {
    await render();
    await emit('turn.started', { turnId: 'turn-1' });
    await emit('turn.delta', { turnId: 'turn-1', textDelta: '第一段' });
    await render(true);
    await emit('turn.delta', { turnId: 'turn-1', accumulated: '第一段，第二段' });
    await emit('turn.end', { turnId: 'turn-1', status: 'completed' });
    state.feed = [entry(1, '第一段，第二段')];
    await render();
    expect(host.querySelectorAll('.chat-message')).toHaveLength(1);
    expect(host.textContent).toContain('第一段，第二段');
    await emit('turn.delta', { turnId: 'turn-1', textDelta: '不应出现' });
    expect(host.textContent).not.toContain('不应出现');
  });
  it('ignores deltas for an older turn and displays current-turn failures', async () => {
    await render();
    await emit('turn.started', { turnId: 'turn-1' });
    await emit('turn.started', { turnId: 'turn-2' });
    await emit('turn.delta', { turnId: 'turn-1', textDelta: '旧内容' });
    await emit('turn.delta', { turnId: 'turn-2', textDelta: '新内容' });
    expect(host.textContent).not.toContain('旧内容');
    expect(host.textContent).toContain('新内容');
    await emit('turn.end', { turnId: 'turn-2', status: 'failed', error: '模型暂时不可用' });
    expect(host.querySelector('.message-error')!.textContent).toContain('模型暂时不可用');
  });
  it('paginates with the oldest sequence and keeps messages after a concurrent refresh', async () => {
    state.feed = Array.from({ length: 50 }, (_, index) => entry(index + 51, `回答 ${index + 51}`));
    state.older.mockResolvedValue([entry(50, '更早的回答')]);
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('.load-history')!.click());
    expect(state.older).toHaveBeenCalledWith(
      expect.objectContaining({ beforeSeq: 51, order: 'desc' })
    );
    state.feed = [entry(101, '最新的回答'), ...state.feed.slice(1)];
    await render();
    expect(host.textContent).toContain('更早的回答');
    expect(host.textContent).toContain('最新的回答');
    expect(host.querySelectorAll('.chat-message')).toHaveLength(52);
  });
  it('shows history failure and allows retry', async () => {
    state.feed = Array.from({ length: 50 }, (_, i) => entry(i + 1, `${i}`));
    state.older.mockRejectedValue(new Error('历史读取失败'));
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('.load-history')!.click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('历史读取失败');
  });
});

describe('Panel permission lifecycle', () => {
  it('restores pending approval on mount and retains it across hidden state and tool events', async () => {
    state.pending = [
      {
        requestId: 'request-1',
        payload: { kind: 'permission', toolName: 'bash', command: 'git reset --hard', tier: 3 },
      },
    ];
    await render();
    expect(host.textContent).toContain('git reset --hard');
    await render(true);
    await emit('turn.started', { turnId: 'turn-1' });
    await emit('turn.tool_call', {
      turnId: 'turn-1',
      toolName: 'bash',
      args: { command: 'git reset --hard' },
    });
    await render();
    expect(host.querySelector('[aria-label="允许"]')).not.toBeNull();
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it.each([true, false])('resolves a request with approved=%s', async (approved) => {
    await render();
    await emit('turn.started', { turnId: 'turn-1' });
    await request();
    await click(approved ? '允许' : '拒绝');
    expect(state.resolve).toHaveBeenCalledWith({ requestId: 'request-1', approved });
    expect(host.querySelector('[aria-label="允许"]')).toBeNull();
  });
  it('removes an approval resolved by another client after refreshing pending requests', async () => {
    await render();
    await request();
    expect(host.querySelector('[aria-label="允许"]')).not.toBeNull();
    state.pending = [];
    state.pendingAt = Date.now() + 1;
    await render();
    expect(host.querySelector('[aria-label="允许"]')).toBeNull();
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it('sets trustWorkspace only for an allowed workspace request', async () => {
    await render();
    await request('workspace-1', 'workspace_access');
    await click('允许');
    expect(state.resolve).toHaveBeenCalledWith({
      requestId: 'workspace-1',
      approved: true,
      trustWorkspace: true,
    });
  });
  it('keeps failed approvals actionable and reports the error', async () => {
    state.resolve.mockRejectedValueOnce(new Error('审批连接失败'));
    await render();
    await request();
    await click('允许');
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('审批连接失败');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="允许"]')!.disabled).toBe(false);
    await click('拒绝');
    expect(state.resolve).toHaveBeenCalledTimes(2);
  });
  it('serializes repeated approval clicks and preserves a second request', async () => {
    let accept!: (value: { success: boolean }) => void;
    state.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    await render();
    await request();
    await request('request-2');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="允许"]')!.click();
      host.querySelector<HTMLButtonElement>('[aria-label="拒绝"]')!.click();
    });
    expect(state.resolve).toHaveBeenCalledTimes(1);
    await act(async () => accept({ success: true }));
    expect(host.querySelector('[aria-label="允许"]')).not.toBeNull();
    await click('拒绝');
    expect(state.resolve).toHaveBeenLastCalledWith({ requestId: 'request-2', approved: false });
  });
  it('does not time out approval or completed answers after 15 seconds', async () => {
    vi.useFakeTimers();
    await render();
    await emit('turn.started', { turnId: 'turn-1' });
    await request();
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(host.querySelector('[aria-label="允许"]')).not.toBeNull();
    await click('允许');
    await emit('turn.delta', { turnId: 'turn-1', accumulated: '完成' });
    await emit('turn.end', { turnId: 'turn-1', status: 'completed' });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(host.textContent).toContain('完成');
  });
});
