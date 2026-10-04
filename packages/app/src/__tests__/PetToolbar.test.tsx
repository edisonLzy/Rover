// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PetToolbar } from '../features/pet/PetToolbar/index.js';
import { EditorContent, type Editor } from '@tiptap/react';
import { usePromptEditor } from '../features/pet/PetToolbar/PromptInput/usePromptEditor.js';

vi.mock('../context/RuntimeContext.js', () => ({ useRuntime: () => ({ connection: {} }) }));
vi.mock('../utils/trpc.js', () => ({
  trpc: {
    tasks: {
      list: {
        useQuery: () => ({
          data: [
            {
              id: 'task-1',
              goal: '检查项目',
              agent: 'codex',
              status: 'running',
              updatedAt: 1,
              createdAt: 1,
            },
          ],
          isPending: false,
        }),
      },
      openTerminal: {
        useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }) }),
      },
    },
  },
}));

let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
let props: Parameters<typeof PetToolbar>[0];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  document.elementFromPoint = () => document.body;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  props = {
    petHovered: true,
    isBusy: false,
    submissionUnavailable: null,
    onSubmit: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function render(overrides: Partial<typeof props> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(<PetToolbar {...props} />));
}
async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
async function edit() {
  await click('编辑 Prompt');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return host.querySelector<HTMLElement>('[role="textbox"]')!;
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
  await act(async () => {
    host
      .querySelector('[role="textbox"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...options }));
  });
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

describe('012 toolbar and real Tiptap interactions', () => {
  it('focuses the editor and hides an empty toolbar after hover and focus leave', async () => {
    await render();
    const textbox = await edit();
    expect(document.activeElement).toBe(textbox);
    await render({ petHovered: false });
    await act(async () => {
      textbox.blur();
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(host.querySelector<HTMLElement>('.pet-toolbar')!.hidden).toBe(true);
  });

  it('restores the controls after an empty editor loses focus while Task stays open', async () => {
    await render();
    await click('任务');
    const textbox = await edit();
    await render({ petHovered: false });
    await act(async () => {
      textbox.blur();
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(host.querySelector<HTMLElement>('.pet-toolbar')!.hidden).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="任务"]')!.hidden).toBe(false);
    expect(host.querySelector('[aria-label="任务列表"]')).not.toBeNull();
  });

  it('keeps the toolbar visible while moving from Pet to Toolbar', async () => {
    await render();
    await render({ petHovered: false });
    await act(async () =>
      host
        .querySelector('.pet-toolbar')!
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(host.querySelector<HTMLElement>('.pet-toolbar')!.hidden).toBe(false);
  });

  it('keeps a text draft visible after losing focus', async () => {
    await render();
    const textbox = await edit();
    await type('保留草稿');
    await render({ petHovered: false });
    await act(async () => {
      textbox.blur();
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(host.querySelector<HTMLElement>('.pet-toolbar')!.hidden).toBe(false);
    expect(textbox.textContent).toBe('保留草稿');
  });

  it('waits for acceptance, rejects duplicate Enter and then restores the buttons', async () => {
    const request = deferred();
    const onSubmit = vi.fn(() => request.promise);
    await render({ onSubmit });
    const textbox = await edit();
    await type('发送这条输入');
    await key('Enter');
    await key('Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(textbox.textContent).toBe('发送这条输入');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="发送给 Rover"]')!.disabled).toBe(
      true
    );
    await act(async () => request.resolve());
    expect(textbox.textContent).toBe('');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="编辑 Prompt"]')!.hidden).toBe(false);
  });

  it('preserves input and shows a recoverable error after Runtime rejects it', async () => {
    await render({ onSubmit: vi.fn().mockRejectedValue(new Error('请求失败')) });
    const textbox = await edit();
    await type('失败后仍然保留');
    await key('Enter');
    expect(textbox.textContent).toBe('失败后仍然保留');
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('请求失败');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="编辑 Prompt"]')!.hidden).toBe(true);
  });

  it('preserves offline input without submitting it', async () => {
    await render({ submissionUnavailable: 'Runtime 离线，请稍后重试' });
    const textbox = await edit();
    await type('离线草稿');
    await key('Enter');
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(textbox.textContent).toBe('离线草稿');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Runtime 离线');
  });

  it('selects an Agent with Enter and treats a reference-only input as a draft', async () => {
    await render();
    const textbox = await edit();
    await type('@Codex');
    await key('Enter');
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(textbox.textContent).toContain('@Codex');
    await render({ petHovered: false });
    await act(async () => {
      textbox.blur();
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(host.querySelector<HTMLElement>('.pet-toolbar')!.hidden).toBe(false);
    await key('Enter');
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'reference', kind: 'agent', id: 'codex' }),
        ]),
      })
    );
  });

  it('does not submit IME Enter or Shift+Enter', async () => {
    await render();
    const textbox = await edit();
    await type('你好');
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

  it('keeps queued prompts until their request is accepted and allows a retry', async () => {
    await render({ isBusy: true });
    await edit();
    await type('下一条输入');
    await key('Enter');
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="待处理 Prompt"]')!.textContent).toContain('下一条输入');
    const request = deferred();
    const onSubmit = vi.fn(() => request.promise);
    await render({ isBusy: false, onSubmit });
    const continueButton = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === '继续下一条'
      )!;
    await act(async () => continueButton().click());
    expect(host.querySelector('[aria-label="待处理 Prompt"]')).not.toBeNull();
    await act(async () => request.reject(new Error('发送失败')));
    expect(host.querySelector('[aria-label="待处理 Prompt"]')!.textContent).toContain('下一条输入');
    await render({ onSubmit: vi.fn().mockResolvedValue(undefined) });
    await act(async () => continueButton().click());
    expect(host.querySelector('[aria-label="待处理 Prompt"]')).toBeNull();
  });

  it('keeps the Task list mounted while entering and leaving input mode', async () => {
    await render();
    await click('任务');
    const list = host.querySelector('[aria-label="任务列表"]');
    expect(list!.textContent).toContain('检查项目');
    await edit();
    expect(host.querySelector('[aria-label="任务列表"]')).toBe(list);
    await type('继续输入');
    await key('Enter');
    expect(host.querySelector('[aria-label="任务列表"]')).toBe(list);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Inbox"]')!.disabled).toBe(true);
  });

  it('does not clear a newer document when an older submission resolves', async () => {
    const request = deferred();
    let editor: Editor | null = null;
    function EditorHarness() {
      const prompt = usePromptEditor({ onSubmit: () => request.promise });
      editor = prompt.editor;
      return <EditorContent editor={prompt.editor} />;
    }
    await act(async () => root.render(<EditorHarness />));
    await act(async () => editor!.commands.setContent('<p>旧草稿</p>'));
    await key('Enter');
    await act(async () => editor!.commands.setContent('<p>新的草稿</p>'));
    await act(async () => request.resolve());
    expect(host.querySelector('[role="textbox"]')!.textContent).toBe('新的草稿');
  });

  it('can unmount while a submission is pending', async () => {
    const request = deferred();
    await render({ onSubmit: () => request.promise });
    await edit();
    await type('待发送');
    await key('Enter');
    await act(async () => root.unmount());
    mounted = false;
    await act(async () => request.resolve());
    expect(host.childElementCount).toBe(0);
  });
});
