import { describe, expect, it } from 'vitest';
import {
  parsePromptDocument,
  safeParsePromptDocument,
  type PromptDocumentV1,
} from '../types/prompt.js';
import { parsePromptDocumentContent } from '../modules/agent/runtime/prompts.js';

describe('PromptDocumentV1 Contract & Schema Validation (Ticket 002)', () => {
  it('validates a correct PromptDocumentV1 with text and references', () => {
    const validDoc: PromptDocumentV1 = {
      v: 1,
      parts: [
        { type: 'reference', kind: 'agent', id: 'claude', label: '@Claude Code' },
        { type: 'text', text: ' 帮我修复 ' },
        { type: 'reference', kind: 'skill', id: 'agent-dispatch', label: '/agent-dispatch' },
        { type: 'text', text: ' 并在 ' },
        { type: 'reference', kind: 'inbox', id: 'msg_99', label: '#99' },
      ],
    };

    const parsed = parsePromptDocument(validDoc);
    expect(parsed.v).toBe(1);
    expect(parsed.parts).toHaveLength(5);

    const { plainText } = parsePromptDocumentContent(parsed);
    expect(plainText).toBe(
      '@Claude Code 帮我修复 /agent-dispatch 并在 #99 [inboxMessageId="msg_99"]'
    );
  });

  it('rejects documents with wrong version or empty parts', () => {
    const wrongVersion = {
      v: 2,
      parts: [{ type: 'text', text: 'hello' }],
    };
    expect(safeParsePromptDocument(wrongVersion).success).toBe(false);

    const emptyParts = {
      v: 1,
      parts: [],
    };
    expect(safeParsePromptDocument(emptyParts).success).toBe(false);
  });

  it('rejects invalid reference kinds or missing required attributes', () => {
    const invalidKind = {
      v: 1,
      parts: [{ type: 'reference', kind: 'unknown_kind', id: '1', label: 'test' }],
    };
    expect(safeParsePromptDocument(invalidKind).success).toBe(false);

    const missingId = {
      v: 1,
      parts: [{ type: 'reference', kind: 'agent', label: 'test' }],
    };
    expect(safeParsePromptDocument(missingId).success).toBe(false);
  });
});
