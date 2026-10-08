// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WecomConfigCard } from '../features/dashboard/inbox-settings/WecomConfigCard.js';
import { InboxSettingsView } from '../features/dashboard/inbox-settings/index.js';

const mockUpdateMutation = vi.hoisted(() => vi.fn());
const mockTestMutation = vi.hoisted(() => vi.fn());
const mockUnmaskedQuery = vi.hoisted(() => vi.fn());
const mockInvalidate = vi.hoisted(() => vi.fn());
const mockRefetch = vi.hoisted(() => vi.fn());

let registeredHandlers: Record<string, Function> = {};

vi.mock('../context/RuntimeContext.js', () => ({
  useRuntime: () => ({
    connection: {},
    wsClient: {
      registerEventHandler: (handlers: Record<string, Function>) => {
        registeredHandlers = { ...registeredHandlers, ...handlers };
        return () => {};
      },
    },
  }),
}));

vi.mock('../utils/trpc.js', () => ({
  trpc: {
    useUtils: () => ({
      inbox: {
        getWecomConfig: {
          invalidate: mockInvalidate,
        },
      },
      client: {
        inbox: {
          getWecomConfig: {
            query: mockUnmaskedQuery,
          },
        },
      },
    }),
    inbox: {
      getWecomConfig: {
        useQuery: () => ({
          data: {
            enabled: true,
            botId: 'bot-12345',
            botSecret: 'sec_••••••••9999',
            wsUrl: '',
            status: 'connected',
          },
          isLoading: false,
          refetch: mockRefetch,
        }),
      },
      updateWecomConfig: {
        useMutation: (opts?: any) => ({
          mutateAsync: async (args: any) => {
            const res = await mockUpdateMutation(args);
            opts?.onSuccess?.(res);
            return res;
          },
          isPending: false,
        }),
      },
      testWecomConnection: {
        useMutation: (opts?: any) => ({
          mutateAsync: async (args: any) => {
            const res = await mockTestMutation(args);
            opts?.onSuccess?.(res);
            return res;
          },
          isPending: false,
        }),
      },
    },
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  registeredHandlers = {};
  mockUpdateMutation.mockReset().mockResolvedValue({
    enabled: true,
    botId: 'bot-12345',
    botSecret: 'sec_••••••••9999',
    status: 'connected',
  });
  mockTestMutation.mockReset().mockResolvedValue({
    success: true,
    latencyMs: 42,
  });
  mockUnmaskedQuery.mockReset().mockResolvedValue({
    enabled: true,
    botId: 'bot-12345',
    botSecret: 'plain_secret_value_9999',
    status: 'connected',
  });
  mockInvalidate.mockReset();
  mockRefetch.mockReset();

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Dashboard Inbox Settings (Ticket 004)', () => {
  it('renders WecomConfigCard with initial connected status badge and masked secret', async () => {
    await act(async () => {
      root.render(<WecomConfigCard />);
    });

    // Check title and status badge
    expect(host.textContent).toContain('企业微信智能机器人');
    expect(host.textContent).toContain('已连接');

    // Check Bot ID input
    const botIdInput = host.querySelector('#wecom-bot-id') as HTMLInputElement;
    expect(botIdInput).not.toBeNull();
    expect(botIdInput.value).toBe('bot-12345');

    // Check Bot Secret input has masked value and password type
    const botSecretInput = host.querySelector('#wecom-bot-secret') as HTMLInputElement;
    expect(botSecretInput).not.toBeNull();
    expect(botSecretInput.value).toBe('sec_••••••••9999');
    expect(botSecretInput.type).toBe('password');

    // Check eye button is present
    const eyeBtn = host.querySelector('button[aria-label="显示密钥"]');
    expect(eyeBtn).not.toBeNull();
  });

  it('switches between masked and plaintext secret when clicking the eye button', async () => {
    await act(async () => {
      root.render(<WecomConfigCard />);
    });

    const botSecretInput = host.querySelector('#wecom-bot-secret') as HTMLInputElement;
    expect(botSecretInput.type).toBe('password');

    const eyeBtn = host.querySelector('button[aria-label="显示密钥"]') as HTMLButtonElement;
    expect(eyeBtn).not.toBeNull();

    // Click to unmask
    await act(async () => {
      eyeBtn.click();
    });

    // Should fetch unmasked secret from server
    expect(mockUnmaskedQuery).toHaveBeenCalledWith({ unmask: true });
    expect(botSecretInput.type).toBe('text');
    expect(botSecretInput.value).toBe('plain_secret_value_9999');

    // Button label changes to "隐藏密钥"
    const hideBtn = host.querySelector('button[aria-label="隐藏密钥"]') as HTMLButtonElement;
    expect(hideBtn).not.toBeNull();

    // Click again to hide
    await act(async () => {
      hideBtn.click();
    });

    expect(botSecretInput.type).toBe('password');
  });

  it('performs test connection and displays latency result or error feedback', async () => {
    await act(async () => {
      root.render(<WecomConfigCard />);
    });

    const testBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('测试连接')
    );
    expect(testBtn).toBeDefined();

    // Click test connection
    await act(async () => {
      testBtn!.click();
    });

    expect(mockTestMutation).toHaveBeenCalledWith({
      botId: 'bot-12345',
      botSecret: 'sec_••••••••9999',
      wsUrl: undefined,
    });

    expect(host.textContent).toContain('连接测试成功！握手往返延迟: 42ms');

    // Now test failure
    mockTestMutation.mockResolvedValueOnce({
      success: false,
      error: '企微网关连接超时',
    });

    await act(async () => {
      testBtn!.click();
    });

    expect(host.textContent).toContain('连接测试失败: 企微网关连接超时');
  });

  it('saves updated configuration when clicking save', async () => {
    await act(async () => {
      root.render(<WecomConfigCard />);
    });

    const botIdInput = host.querySelector('#wecom-bot-id') as HTMLInputElement;
    await act(async () => {
      // User changes bot ID
      setInputValue(botIdInput, 'bot-updated-67890');
    });

    const saveBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存配置')
    );
    expect(saveBtn).toBeDefined();

    await act(async () => {
      saveBtn!.click();
    });

    expect(mockUpdateMutation).toHaveBeenCalledWith({
      enabled: true,
      botId: 'bot-updated-67890',
      botSecret: 'sec_••••••••9999',
      wsUrl: undefined,
    });

    expect(host.textContent).toContain('配置已保存！');
  });

  it('folds form when switch is toggled and allows saving disabled state', async () => {
    await act(async () => {
      root.render(<WecomConfigCard />);
    });

    const switchBtn = host.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(switchBtn).not.toBeNull();
    expect(switchBtn.getAttribute('aria-checked')).toBe('true');

    // Click switch to toggle off
    await act(async () => {
      switchBtn.click();
    });

    expect(switchBtn.getAttribute('aria-checked')).toBe('false');
    // Form fields should be collapsed
    expect(host.querySelector('#wecom-bot-id')).toBeNull();
    expect(host.textContent).toContain('集成已处于停用状态');

    // Save disabled state
    const saveDisabledBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存停用状态')
    );
    expect(saveDisabledBtn).toBeDefined();

    await act(async () => {
      saveDisabledBtn!.click();
    });

    expect(mockUpdateMutation).toHaveBeenCalledWith({
      enabled: false,
      botId: 'bot-12345',
      botSecret: 'sec_••••••••9999',
      wsUrl: undefined,
    });
  });

  it('updates status badge reactively upon receiving WebSocket status event', async () => {
    await act(async () => {
      root.render(<WecomConfigCard />);
    });

    expect(host.textContent).toContain('已连接');

    // Simulate WebSocket event for auth failure
    expect(registeredHandlers['inbox.provider.status']).toBeDefined();
    await act(async () => {
      registeredHandlers['inbox.provider.status']({
        providerId: 'wecom',
        status: 'auth_failed',
      });
    });

    expect(host.textContent).toContain('认证失败');
  });

  it('renders the complete InboxSettingsView with header, cards, and security notice', async () => {
    await act(async () => {
      root.render(<InboxSettingsView />);
    });

    expect(host.textContent).toContain('消息集成 (Inbox Integrations)');
    expect(host.textContent).toContain('M3 Gateway');
    expect(host.textContent).toContain('企业微信智能机器人');
    expect(host.textContent).toContain('飞书 / 钉钉智能机器人');
    expect(host.textContent).toContain('外部消息防注入隔离保证');
  });
});
