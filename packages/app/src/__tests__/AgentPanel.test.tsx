// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPanel } from '../features/pet/AgentPanel/index.js';
import { EditorContent, type Editor } from '@tiptap/react';
import { usePromptEditor } from '../features/pet/AgentPanel/PromptInput/usePromptEditor.js';

const state = vi.hoisted(() => ({
  terminal: vi.fn(),
  delegated: vi.fn(),
  messages: [] as any[],
  unread: 0,
  tasks: [
    {
      id: 'task-1',
      goal: '检查项目',
      agent: 'codex',
      status: 'running',
      updatedAt: 1,
      createdAt: 1,
    },
    {
      id: 'task-2',
      goal: '确认发布',
      agent: 'claude',
      status: 'needs_intervention',
      updatedAt: 2,
      createdAt: 1,
    },
  ],
}));
vi.mock('../context/RuntimeContext.js', () => ({ useRuntime: () => ({ connection: {} }) }));
vi.mock('../utils/trpc.js', () => ({
  trpc: {
    useUtils: () => ({
      inbox: { list: { invalidate: vi.fn() }, getUnreadCount: { invalidate: vi.fn() } },
    }),
    inbox: {
      list: { useQuery: () => ({ data: state.messages, isPending: false, error: null }) },
      getUnreadCount: { useQuery: () => ({ data: state.unread }) },
      markAsDelegated: { useMutation: () => ({ mutateAsync: state.delegated }) },
    },
    tasks: {
      list: { useQuery: () => ({ data: state.tasks, isPending: false }) },
      openTerminal: { useMutation: () => ({ mutateAsync: state.terminal }) },
    },
  },
}));
let host: HTMLDivElement;
let root: Root;
let props: Parameters<typeof AgentPanel>[0];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  state.terminal.mockReset().mockResolvedValue({ success: true });
  state.delegated.mockReset().mockResolvedValue({ success: true });
  state.messages = [];
  state.unread = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    expanded: true,
    isBusy: false,
    scale: 1,
    submissionUnavailable: null,
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onCollapse: vi.fn(),
    followUps: {
      items: [],
      syncing: false,
      startingId: null,
      error: null,
      canAdvance: false,
      highlightedId: undefined,
      enqueue: vi.fn().mockResolvedValue(undefined),
      advance: vi.fn(),
      remove: vi.fn(),
      reorder: vi.fn(),
    },
    conversation: {
      messages: [],
      processing: { status: 'idle' },
      hasApproval: false,
      resolving: false,
      approvalError: null,
      historyError: undefined,
      loading: false,
      loadingOlder: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      retry: vi.fn(),
      approve: vi.fn(),
      deny: vi.fn(),
    },
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(overrides: Partial<typeof props> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(<AgentPanel {...props} />));
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector)!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}
async function type(text: string) {
  const textbox = host.querySelector<HTMLElement>('[role="textbox"]')!;
  await act(async () => {
    textbox.querySelector('p')!.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(textbox.querySelector('p')!);
    range.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    textbox.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function key(keyName: string, options: KeyboardEventInit = {}) {
  await act(async () =>
    host
      .querySelector('[role="textbox"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...options }))
  );
}
function deferred() {
  let resolve!: () => void;
  let reject!: (failure: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function inboxMessage() {
  return {
    id: 'inbox-1',
    sourceId: 'wecom',
    sourceMessageId: 'message-1',
    revision: 1,
    kind: 'alert',
    title: '支付失败',
    summary: '结账时出现 500',
    url: null,
    status: 'unread',
    taskId: null,
    occurredAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    payload: {},
  };
}

describe('Agent Panel navigation and persistent composer', () => {
  it('preserves the editor, tab and draft across collapse and tab changes', async () => {
    await render();
    await type('保留草稿');
    const textbox = host.querySelector('[role="textbox"]');
    await click('#panel-tab-task');
    expect(host.querySelector<HTMLDivElement>('#panel-view-chat')!.hidden).toBe(true);
    expect(host.querySelector<HTMLDivElement>('#panel-view-task')!.hidden).toBe(false);
    await render({ expanded: false });
    await render({ expanded: true });
    expect(host.querySelector('[role="textbox"]')).toBe(textbox);
    expect(textbox!.textContent).toBe('保留草稿');
    expect(host.querySelector('#panel-tab-task')!.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.pet-composer')!.querySelectorAll('button')).toHaveLength(1);
  });
  it('supports keyboard tabs and search without clearing the draft', async () => {
    await render();
    await type('我的输入');
    await act(async () =>
      host
        .querySelector('#panel-tab-chat')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    );
    expect(host.querySelector('#panel-tab-task')!.getAttribute('aria-selected')).toBe('true');
    await click('[aria-label="搜索"]');
    const input = host.querySelector<HTMLInputElement>('[aria-label="搜索当前面板"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '没有匹配');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('.task-list')!.textContent).toContain('没有匹配的任务');
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('我的输入');
  });
  it('prioritizes intervention and keeps session opening errors local to Tasks', async () => {
    await render();
    await click('#panel-tab-task');
    expect(host.querySelector('.task-row')!.textContent).toContain('确认发布');
    state.terminal.mockResolvedValue({ success: true, notice: 'Yes, I trust this folder' });
    await click('.task-session');
    expect(state.terminal).toHaveBeenCalledWith({ taskId: 'task-2' });
    expect(host.querySelector('.panel-notice')!.textContent).toContain('Yes, I trust this folder');
    state.terminal.mockResolvedValue({ success: false, error: '打开失败' });
    await click('.task-session');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('打开失败');
    expect(host.querySelector('.panel-notice')).toBeNull();
  });
  it('rejects duplicate Enter until acceptance and retains a failed draft', async () => {
    const request = deferred();
    await render({ onSubmit: vi.fn(() => request.promise) });
    await type('发送这条输入');
    await key('Enter');
    await key('Enter');
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="发送给 Rover"]')!.disabled).toBe(
      true
    );
    await act(async () => request.reject(new Error('请求失败')));
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('发送这条输入');
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('请求失败');
    await render({ onSubmit: vi.fn().mockResolvedValue(undefined) });
    await key('Enter');
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('');
  });
  it('keeps offline input without submitting', async () => {
    await render({ submissionUnavailable: 'Runtime 离线，请稍后重试' });
    await type('离线草稿');
    await key('Enter');
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('离线草稿');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Runtime 离线');
  });
  it('does not submit IME Enter or Shift+Enter', async () => {
    await render();
    await type('你好');
    const textbox = host.querySelector('[role="textbox"]')!;
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    );
    await key('Enter', { isComposing: true });
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    );
    await key('Enter', { shiftKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
    await key('Enter');
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
  it('selects an Agent reference first and sends it on a second Enter', async () => {
    await render();
    await type('@Codex');
    await key('Enter');
    expect(props.onSubmit).not.toHaveBeenCalled();
    await key('Enter');
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'reference', kind: 'agent', id: 'codex' }),
        ]),
      })
    );
  });
  it('dismisses suggestions with Escape while keeping the draft', async () => {
    await render();
    await type('@Co');
    expect(document.querySelector('.pet-suggestions')).not.toBeNull();
    await key('Escape');
    expect(document.querySelector('.pet-suggestions')).toBeNull();
    expect(host.querySelector('[role="textbox"]')!.textContent).toContain('@Co');
    expect(props.onCollapse).not.toHaveBeenCalled();
    await key('Escape');
    expect(props.onCollapse).toHaveBeenCalledTimes(1);
  });
  it('queues busy input and keeps drafts on enqueue failure', async () => {
    props.followUps.enqueue = vi.fn().mockRejectedValue(new Error('排队失败'));
    await render({ isBusy: true });
    await type('下一条输入');
    await key('Enter');
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.followUps.enqueue).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('下一条输入');
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('排队失败');
  });
  it('does not clear a newer document when an older submission resolves', async () => {
    const request = deferred();
    let editor: Editor | null = null;
    function Harness() {
      const prompt = usePromptEditor({ onSubmit: () => request.promise });
      editor = prompt.editor;
      return <EditorContent editor={prompt.editor} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => editor!.commands.setContent('<p>旧草稿</p>'));
    await key('Enter');
    await act(async () => editor!.commands.setContent('<p>新草稿</p>'));
    await act(async () => request.resolve());
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('新草稿');
  });
});

describe('Events handoff', () => {
  beforeEach(() => {
    state.messages = [inboxMessage()];
    state.unread = 1;
  });
  it.each([false, true])(
    'hands off with busy=%s and marks delegated only after acceptance',
    async (isBusy) => {
      await render({ isBusy });
      await click('#panel-tab-inbox');
      expect(host.querySelector('[aria-label="1 条未读消息"]')).not.toBeNull();
      await click('.event-handoff');
      const submit = isBusy ? props.followUps.enqueue : props.onSubmit;
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({ type: 'reference', kind: 'inbox', id: 'inbox-1' }),
          ]),
        })
      );
      expect(state.delegated).toHaveBeenCalledWith({ id: 'inbox-1' });
      expect(host.querySelector('#panel-tab-chat')!.getAttribute('aria-selected')).toBe('true');
    }
  );
  it('keeps a failed handoff in Events without marking delegated', async () => {
    await render({ onSubmit: vi.fn().mockRejectedValue(new Error('未能发送')) });
    await click('#panel-tab-inbox');
    await click('.event-handoff');
    expect(state.delegated).not.toHaveBeenCalled();
    expect(host.querySelector('#panel-tab-inbox')!.getAttribute('aria-selected')).toBe('true');
  });
  it('offers # references and sends the selected Inbox ID', async () => {
    await render();
    await type('#支付');
    await key('Enter');
    await key('Enter');
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: expect.arrayContaining([expect.objectContaining({ kind: 'inbox', id: 'inbox-1' })]),
      })
    );
  });
});
