import type { Editor, JSONContent } from '@tiptap/core';
import type { PromptDocumentV1, PromptPart } from '@rover/runtime/expose';
import { REFERENCE_NODE_NAME } from './extensions/mentionNode.js';

export function serializeEditorContent(editor: Editor): PromptDocumentV1 | null {
  const json = editor.getJSON();
  return serializeProseMirrorDoc(json);
}

export function serializeProseMirrorDoc(doc: JSONContent): PromptDocumentV1 | null {
  if (!doc || !doc.content || doc.content.length === 0) {
    return null;
  }

  const rawParts: PromptPart[] = [];
  let currentBuffer = '';

  const flushBuffer = () => {
    if (currentBuffer) {
      rawParts.push({
        type: 'text',
        text: currentBuffer,
      });
      currentBuffer = '';
    }
  };

  const traverseNodes = (nodes: JSONContent[], isFirstBlock = true) => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (node.type === 'paragraph') {
        if (!isFirstBlock || i > 0) {
          currentBuffer += '\n';
        }
        if (node.content && node.content.length > 0) {
          traverseNodes(node.content, false);
        }
      } else if (node.type === 'text') {
        currentBuffer += node.text ?? '';
      } else if (node.type === 'hardBreak') {
        currentBuffer += '\n';
      } else if (node.type === REFERENCE_NODE_NAME) {
        flushBuffer();
        const attrs = node.attrs || {};
        const id = attrs.id ? String(attrs.id) : '';
        const label = attrs.label ? String(attrs.label) : id;
        const kind = attrs.kind === 'skill' || attrs.kind === 'inbox' ? attrs.kind : 'agent';

        if (id && label) {
          rawParts.push({
            type: 'reference',
            kind,
            id,
            label,
          });
        }
      } else if (node.content && node.content.length > 0) {
        traverseNodes(node.content, false);
      }
    }
  };

  traverseNodes(doc.content, true);
  flushBuffer();

  // Trim leading/trailing whitespace across the document
  if (rawParts.length === 0) {
    return null;
  }

  // Optimize and merge consecutive text parts
  const mergedParts: PromptPart[] = [];
  for (const part of rawParts) {
    const last = mergedParts[mergedParts.length - 1];
    if (part.type === 'text' && last && last.type === 'text') {
      last.text += part.text;
    } else {
      mergedParts.push({ ...part });
    }
  }

  // Check if it only contains empty whitespace text
  const totalMeaningfulContent = mergedParts.some((p) => {
    if (p.type === 'reference') return true;
    return p.text.trim().length > 0;
  });

  if (!totalMeaningfulContent) {
    return null;
  }

  const promptDoc: PromptDocumentV1 = {
    v: 1,
    parts: mergedParts,
  };

  return promptDoc;
}
