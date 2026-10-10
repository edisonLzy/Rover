// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PetBubble } from '../features/pet/PetBubble/index.js';
import type { BubbleState } from '../features/pet/PetBubble/types.js';

const mockState = vi.hoisted(() => ({
  handlersList: [] as Array<Record<string, (payload: any) => void>>,
  resolveMutation: vi.fn().mockResolvedValue({ success: true }),
  pendingRequests: [] as any[],
}));

const mockWsClient = {
  registerEventHandler: (handlers: Record<string, (payload: any) => void>) => {
    mockState.handlersList.push(handlers);
    return () => {
      const idx = mockState.handlersList.indexOf(handlers);
      if (idx !== -1) mockState.handlersList.splice(idx, 1);
    };
  },
};

vi.mock('../context/RuntimeContext.js', () => ({
  useRuntime: () => ({
    wsClient: mockWsClient,
  }),
}));

vi.mock('../utils/trpc.js', () => ({
  trpc: {
    permissions: {
      resolve: {
        useMutation: () => ({
          mutateAsync: mockState.resolveMutation,
        }),
      },
      getPendingRequests: {
        useQuery: () => ({
          data: mockState.pendingRequests,
        }),
      },
    },
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  mockState.handlersList = [];
  mockState.resolveMutation.mockClear();
  mockState.pendingRequests = [];
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

async function renderBubble(props: Parameters<typeof PetBubble>[0] = {}) {
  await act(async () => root.render(<PetBubble {...props} />));
}

async function emitEvent(type: string, payload: any) {
  await act(async () => {
    for (const handler of mockState.handlersList) {
      if (handler[type]) {
        handler[type](payload);
      }
    }
  });
}

describe('022c PetBubble compact two-phase and HITL approval', () => {
  describe('Controlled Discriminated Union rendering', () => {
    it('renders single-line compact thinking with speech-spinner', async () => {
      const state: BubbleState = { status: 'thinking' };
      await renderBubble({ state });

      expect(host.querySelector('.speech-spinner')).not.toBeNull();
      expect(host.textContent).toContain('正在思考中…');
      expect(host.querySelector('.speech-head')).toBeNull(); // No redundant header
    });

    it('renders single-line tool call pill', async () => {
      const state: BubbleState = {
        status: 'tool_call',
        toolName: 'bash',
        summary: 'bash: git status',
      };
      await renderBubble({ state });

      expect(host.textContent).toContain('⚡');
      expect(host.textContent).toContain('bash: git status');
    });

    it('renders approval card for command risk and triggers resolve', async () => {
      const onApprove = vi.fn();
      const onDeny = vi.fn();
      const state: BubbleState = {
        status: 'approval',
        requestId: 'req_1',
        kind: 'permission',
        icon: '⚡',
        summary: 'bash: rm -rf ./dist',
        payload: { kind: 'permission', toolName: 'bash', command: 'rm -rf ./dist', tier: 3 as any },
      };

      await renderBubble({ state, onApprove, onDeny });

      expect(host.textContent).toContain('bash: rm -rf ./dist');
      const approveBtn = host.querySelector<HTMLButtonElement>('button[aria-label="允许"]');
      const denyBtn = host.querySelector<HTMLButtonElement>('button[aria-label="拒绝"]');
      expect(approveBtn).not.toBeNull();
      expect(denyBtn).not.toBeNull();

      approveBtn!.click();
      expect(onApprove).toHaveBeenCalledTimes(1);

      denyBtn!.click();
      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it('renders approval card for workspace access', async () => {
      const state: BubbleState = {
        status: 'approval',
        requestId: 'req_ws',
        kind: 'workspace_access',
        icon: '📂',
        summary: '访问: /Users/evan/other-repo',
        payload: {
          kind: 'workspace_access',
          toolName: 'bash',
          targetPath: '/Users/evan/other-repo',
          resolvedPath: '/Users/evan/other-repo',
        },
      };

      await renderBubble({ state });
      expect(host.textContent).toContain('📂');
      expect(host.textContent).toContain('访问: /Users/evan/other-repo');
      expect(host.querySelector('button[aria-label="允许"]')).not.toBeNull();
      expect(host.querySelector('button[aria-label="拒绝"]')).not.toBeNull();
    });

    it('renders result state directly without redundant header', async () => {
      const state: BubbleState = {
        status: 'result',
        content: '构建完成，所有单元测试全部通过。',
      };
      await renderBubble({ state });

      expect(host.textContent).toContain('构建完成，所有单元测试全部通过。');
      expect(host.querySelector('.speech-spinner')).toBeNull();
      expect(host.querySelector('.speech-head')).toBeNull();
    });
  });

  describe('Autonomous WebSocket event-driven flow & HITL resolution', () => {
    it('progresses from thinking to tool_call to approval and resolves via tRPC', async () => {
      await renderBubble(); // Autonomous mode

      // Initially idle, nothing rendered
      expect(host.querySelector('.pet-speech')).toBeNull();

      // 1. turn starts -> thinking
      await emitEvent('turn.started', { turnId: 'turn-1' });
      expect(host.textContent).toContain('正在思考中…');
      expect(host.querySelector('.speech-spinner')).not.toBeNull();

      // 2. tool call arrives -> tool_call
      await emitEvent('turn.tool_call', {
        turnId: 'turn-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'rm -rf ./dist' },
      });
      expect(host.textContent).toContain('bash: rm -rf ./dist');

      // 3. permission requested arrives -> approval
      await emitEvent('permission.requested', {
        turnId: 'turn-1',
        requestId: 'req-perm-1',
        payload: {
          kind: 'permission',
          toolName: 'bash',
          command: 'rm -rf ./dist',
          tier: 3,
        },
      });
      expect(host.textContent).toContain('bash: rm -rf ./dist');
      const approveBtn = host.querySelector<HTMLButtonElement>('button[aria-label="允许"]');
      expect(approveBtn).not.toBeNull();

      // 4. Click [允许]
      await act(async () => {
        approveBtn!.click();
      });

      expect(mockState.resolveMutation).toHaveBeenCalledWith({
        requestId: 'req-perm-1',
        approved: true,
      });

      // 5. Tool result arrives -> continues thinking
      await emitEvent('turn.tool_result', {
        turnId: 'turn-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        result: 'Success',
      });
      expect(host.textContent).toContain('正在思考中…');

      // 6. Answer text arrives -> result
      await emitEvent('turn.delta', {
        turnId: 'turn-1',
        textDelta: '删除成功。',
        accumulated: '删除成功。',
        isThinking: false,
      });
      expect(host.textContent).toContain('删除成功。');

      // 7. Turn ends
      await emitEvent('turn.end', { turnId: 'turn-1', status: 'completed' });
      expect(host.textContent).toContain('删除成功。');
      expect(host.querySelector('.speech-spinner')).toBeNull();
    });

    it('resolves workspace access approval with trustWorkspace: true', async () => {
      await renderBubble();

      await emitEvent('turn.started', { turnId: 'turn-ws' });
      await emitEvent('permission.requested', {
        turnId: 'turn-ws',
        requestId: 'req-ws-1',
        payload: {
          kind: 'workspace_access',
          toolName: 'bash',
          targetPath: '/external/dir',
          resolvedPath: '/external/dir',
        },
      });

      expect(host.textContent).toContain('访问: /external/dir');
      const approveBtn = host.querySelector<HTMLButtonElement>('button[aria-label="允许"]')!;

      await act(async () => {
        approveBtn.click();
      });

      expect(mockState.resolveMutation).toHaveBeenCalledWith({
        requestId: 'req-ws-1',
        approved: true,
        trustWorkspace: true,
      });
    });

    it('resolves with approved: false when user clicks [拒绝]', async () => {
      await renderBubble();

      await emitEvent('turn.started', { turnId: 'turn-deny' });
      await emitEvent('permission.requested', {
        turnId: 'turn-deny',
        requestId: 'req-deny-1',
        payload: {
          kind: 'permission',
          toolName: 'bash',
          command: 'dangerous-cmd',
          tier: 3,
        },
      });

      const denyBtn = host.querySelector<HTMLButtonElement>('button[aria-label="拒绝"]')!;
      await act(async () => {
        denyBtn.click();
      });

      expect(mockState.resolveMutation).toHaveBeenCalledWith({
        requestId: 'req-deny-1',
        approved: false,
      });
    });

    it('resolves with approved: false and cleans up when user dismisses the bubble via close button ✕', async () => {
      const onClose = vi.fn();
      await renderBubble({ onClose });

      await emitEvent('turn.started', { turnId: 'turn-close' });
      await emitEvent('permission.requested', {
        turnId: 'turn-close',
        requestId: 'req-close-1',
        payload: {
          kind: 'permission',
          toolName: 'bash',
          command: 'dangerous-cmd',
          tier: 3,
        },
      });

      const closeBtn = host.querySelector<HTMLButtonElement>('button[aria-label="关闭气泡"]')!;
      expect(closeBtn).not.toBeNull();

      await act(async () => {
        closeBtn.click();
      });

      expect(mockState.resolveMutation).toHaveBeenCalledWith({
        requestId: 'req-close-1',
        approved: false,
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('completely disables the 10-second auto-close timer while pending approval', async () => {
      const onClose = vi.fn();
      await renderBubble({ onClose });

      await emitEvent('turn.started', { turnId: 'turn-timer' });
      await emitEvent('permission.requested', {
        turnId: 'turn-timer',
        requestId: 'req-timer-1',
        payload: {
          kind: 'permission',
          toolName: 'bash',
          command: 'rm -rf ./dist',
          tier: 3,
        },
      });

      // Advance 15 seconds: approval card MUST NOT disappear
      await act(async () => {
        vi.advanceTimersByTime(15000);
      });

      expect(onClose).not.toHaveBeenCalled();
      expect(host.querySelector('button[aria-label="允许"]')).not.toBeNull();

      // Complete turn into result state
      await emitEvent('turn.delta', {
        turnId: 'turn-timer',
        accumulated: '完成',
        isThinking: false,
      });
      await emitEvent('turn.end', { turnId: 'turn-timer', status: 'completed' });

      // In result state, 10s auto-close timer should function normally
      await act(async () => {
        vi.advanceTimersByTime(9999);
      });
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('restores pending approval on mount if getPendingRequests returns active items', async () => {
      mockState.pendingRequests = [
        {
          requestId: 'req-mount-1',
          payload: {
            kind: 'permission',
            toolName: 'bash',
            command: 'git reset --hard',
            tier: 3,
          },
        },
      ];

      await renderBubble();

      expect(host.textContent).toContain('bash: git reset --hard');
      expect(host.querySelector('button[aria-label="允许"]')).not.toBeNull();
    });
  });
});
