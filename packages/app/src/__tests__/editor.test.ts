import { describe, expect, it, vi } from 'vitest';
import { serializeProseMirrorDoc } from '../features/pet/editor/serializer.js';
import { filterSuggestions } from '../features/pet/editor/extensions/agentMention.js';
import type { SuggestionItemData } from '../features/pet/editor/types.js';

describe('Prompt Editor & Serialization (Ticket 002)', () => {
  describe('serializeProseMirrorDoc', () => {
    it('serializes plain text into PromptDocumentV1', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '请帮我检查代码' }],
          },
        ],
      };

      const result = serializeProseMirrorDoc(doc);
      expect(result).not.toBeNull();
      expect(result?.v).toBe(1);
      expect(result?.parts).toEqual([{ type: 'text', text: '请帮我检查代码' }]);

      expect(result?.v).toBe(1);
      expect(Array.isArray(result?.parts)).toBe(true);
    });

    it('serializes reference pills and text into structured parts', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'referenceNode',
                attrs: { id: 'claude', label: '@Claude Code', kind: 'agent' },
              },
              { type: 'text', text: ' 请使用 ' },
              {
                type: 'referenceNode',
                attrs: { id: 'agent-dispatch', label: '/agent-dispatch', kind: 'skill' },
              },
              { type: 'text', text: ' 处理任务' },
            ],
          },
        ],
      };

      const result = serializeProseMirrorDoc(doc);
      expect(result).not.toBeNull();
      expect(result?.v).toBe(1);
      expect(result?.parts).toHaveLength(4);
      expect(result?.parts[0]).toEqual({
        type: 'reference',
        kind: 'agent',
        id: 'claude',
        label: '@Claude Code',
      });
      expect(result?.parts[1]).toEqual({
        type: 'text',
        text: ' 请使用 ',
      });
      expect(result?.parts[2]).toEqual({
        type: 'reference',
        kind: 'skill',
        id: 'agent-dispatch',
        label: '/agent-dispatch',
      });
      expect(result?.parts[3]).toEqual({
        type: 'text',
        text: ' 处理任务',
      });

      expect(result?.v).toBe(1);
      expect(Array.isArray(result?.parts)).toBe(true);
    });

    it('merges multiple consecutive text nodes into a single part', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'world ' },
              { type: 'text', text: 'again' },
            ],
          },
        ],
      };

      const result = serializeProseMirrorDoc(doc);
      expect(result?.parts).toHaveLength(1);
      expect(result?.parts[0]).toEqual({
        type: 'text',
        text: 'Hello world again',
      });
    });

    it('returns null for empty or whitespace-only documents', () => {
      expect(serializeProseMirrorDoc({})).toBeNull();
      expect(serializeProseMirrorDoc({ type: 'doc', content: [] })).toBeNull();
      expect(
        serializeProseMirrorDoc({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '   \n  ' }],
            },
          ],
        })
      ).toBeNull();
    });
  });

  describe('filterSuggestions', () => {
    const mockItems: SuggestionItemData[] = [
      { id: 'claude', kind: 'agent', label: 'Claude Code', description: 'Anthropic agent' },
      { id: 'codex', kind: 'agent', label: 'Codex CLI', description: 'OpenAI assistant' },
      { id: 'agent-dispatch', kind: 'skill', label: 'agent-dispatch', description: '派发工具' },
      { id: 'task-recall', kind: 'skill', label: 'task-recall', description: '回忆任务' },
    ];

    it('returns all items when query is empty', () => {
      expect(filterSuggestions(mockItems, '')).toHaveLength(4);
      expect(filterSuggestions(mockItems, '   ')).toHaveLength(4);
    });

    it('filters items case-insensitively by label, id, or description', () => {
      const byLabel = filterSuggestions(mockItems, 'claude');
      expect(byLabel).toHaveLength(1);
      expect(byLabel[0].id).toBe('claude');

      const byDesc = filterSuggestions(mockItems, 'openai');
      expect(byDesc).toHaveLength(1);
      expect(byDesc[0].id).toBe('codex');

      const byChineseDesc = filterSuggestions(mockItems, '回忆');
      expect(byChineseDesc).toHaveLength(1);
      expect(byChineseDesc[0].id).toBe('task-recall');
    });
  });

  describe('IME & Keyboard Interaction Logic', () => {
    it('blocks enter submission when composing (IME active)', () => {
      const onSubmit = vi.fn();
      let isComposing = true;

      const simulateKeyDown = (event: { key: string; shiftKey: boolean; isComposing: boolean }) => {
        if (event.isComposing || isComposing) {
          return false;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          onSubmit();
          return true;
        }
        return false;
      };

      // Pressing enter while composing Chinese pinyin
      const handledWhileComposing = simulateKeyDown({
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
      });
      expect(handledWhileComposing).toBe(false);
      expect(onSubmit).not.toHaveBeenCalled();

      // Composition ends
      isComposing = false;
      const handledNormalEnter = simulateKeyDown({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
      });
      expect(handledNormalEnter).toBe(true);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('supports returning false or throwing from onSubmit to preserve input text without clearing', async () => {
      let contentCleared = false;
      const editorMock = {
        commands: {
          clearContent: () => {
            contentCleared = true;
          },
        },
      };

      const handleSubmit = async (onSubmitFn: () => Promise<boolean | void>) => {
        try {
          const res = await onSubmitFn();
          if (res === false) return;
          editorMock.commands.clearContent();
        } catch {
          // preserve content
        }
      };

      // Case 1: onSubmit returns false (e.g. intercepted due to unconfigured active model)
      await handleSubmit(async () => false);
      expect(contentCleared).toBe(false);

      // Case 2: onSubmit throws error
      await handleSubmit(async () => {
        throw new Error('No active model');
      });
      expect(contentCleared).toBe(false);

      // Case 3: onSubmit succeeds normally
      await handleSubmit(async () => {});
      expect(contentCleared).toBe(true);
    });
  });
});
