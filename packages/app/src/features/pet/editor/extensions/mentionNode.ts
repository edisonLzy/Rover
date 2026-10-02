import { mergeAttributes, type Range } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { ReferencePill } from '../components/ReferencePill.js';
import type { MentionKind, SuggestionItemData } from '../types.js';

export const REFERENCE_NODE_NAME = 'referenceNode';

export interface ReferenceNodeAttrs {
  id: string;
  label: string;
  kind: MentionKind;
}

export interface InsertReferenceOptions {
  editor: Editor;
  item: SuggestionItemData;
  range?: Range;
  trailingSpace?: boolean;
}

export function insertReferenceNode({
  editor,
  item,
  range,
  trailingSpace = true,
}: InsertReferenceOptions) {
  const content = [
    {
      type: REFERENCE_NODE_NAME,
      attrs: {
        id: item.id,
        label: item.label,
        kind: item.kind,
      },
    },
    ...(trailingSpace ? [{ type: 'text', text: ' ' }] : []),
  ];

  const chain = editor.chain().focus();
  if (range) {
    return chain.insertContentAt(range, content).run();
  }
  return chain.insertContent(content).run();
}

export const ReferenceNodeExtension = Mention.extend({
  name: REFERENCE_NODE_NAME,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-reference-id'),
        renderHTML: (attrs: { id?: string }) => ({
          'data-reference-id': attrs.id,
        }),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-reference-label'),
        renderHTML: (attrs: { label?: string }) => ({
          'data-reference-label': attrs.label,
        }),
      },
      kind: {
        default: 'agent',
        parseHTML: (el: HTMLElement) =>
          (el.getAttribute('data-reference-kind') as MentionKind) || 'agent',
        renderHTML: (attrs: { kind?: MentionKind }) => ({
          'data-reference-kind': attrs.kind ?? 'agent',
        }),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferencePill);
  },
}).configure({
  HTMLAttributes: {
    class: 'reference-pill-node',
  },
  renderHTML({ node, options }) {
    const kind = node.attrs.kind || 'agent';
    const prefix = kind === 'agent' ? '@' : kind === 'skill' ? '/' : '#';
    return [
      'span',
      mergeAttributes(options.HTMLAttributes, {
        'data-reference-id': node.attrs.id,
        'data-reference-label': node.attrs.label,
        'data-reference-kind': node.attrs.kind,
      }),
      `${prefix}${node.attrs.label ?? node.attrs.id ?? ''}`,
    ];
  },
});
