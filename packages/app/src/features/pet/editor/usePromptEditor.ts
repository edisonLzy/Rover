import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { PromptDocumentV1 } from '@rover/runtime/expose';
import { ReferenceNodeExtension } from './extensions/mentionNode.js';
import {
  createAgentMentionExtension,
  agentSuggestionPluginKey,
} from './extensions/agentMention.js';
import {
  createSkillMentionExtension,
  skillSuggestionPluginKey,
} from './extensions/skillMention.js';
import {
  createInboxMentionExtension,
  inboxSuggestionPluginKey,
} from './extensions/inboxMention.js';
import { serializeEditorContent } from './serializer.js';
import type { SuggestionItemData } from './types.js';

export interface UsePromptEditorOptions {
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit: (doc: PromptDocumentV1) => Promise<void | boolean> | void | boolean;
  availableAgents?: SuggestionItemData[];
  availableSkills?: SuggestionItemData[];
  availableInboxes?: SuggestionItemData[];
}

export function usePromptEditor(options: UsePromptEditorOptions) {
  const {
    disabled = false,
    placeholder = '输入指令，按 @ 派发 Agent，/ 调用技能，# 引用消息...',
    autoFocus = false,
    onSubmit,
    availableAgents = [],
    availableSkills = [],
    availableInboxes = [],
  } = options;

  const [hasContent, setHasContent] = useState(false);
  const isComposingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const agentsRef = useRef(availableAgents);
  const skillsRef = useRef(availableSkills);
  const inboxesRef = useRef(availableInboxes);
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    agentsRef.current = availableAgents;
    skillsRef.current = availableSkills;
    inboxesRef.current = availableInboxes;
    onSubmitRef.current = onSubmit;
  }, [availableAgents, availableSkills, availableInboxes, onSubmit]);

  const handleSubmit = useCallback(async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || disabled) return;

    const doc = serializeEditorContent(currentEditor);
    if (!doc) return;

    try {
      const result = await onSubmitRef.current(doc);
      if (result === false) {
        return;
      }
      currentEditor.commands.clearContent();
      setHasContent(false);
    } catch {
      // Keep editor content on submission error so user doesn't lose text
    }
  }, [disabled]);

  const isAnySuggestionActive = useCallback((editorInstance: Editor): boolean => {
    const state = editorInstance.state;
    // Check if any mention plugin state has active suggestion
    const agentState = agentSuggestionPluginKey.getState(state);
    const skillState = skillSuggestionPluginKey.getState(state);
    const inboxState = inboxSuggestionPluginKey.getState(state);

    return Boolean(
      (agentState && (agentState as any).active) ||
      (skillState && (skillState as any).active) ||
      (inboxState && (inboxState as any).active)
    );
  }, []);

  const extensions = useMemo(() => {
    return [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        orderedList: false,
        bulletList: false,
        bold: false,
        italic: false,
        strike: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      ReferenceNodeExtension,
      createAgentMentionExtension({
        getAgents: () => agentsRef.current,
      }),
      createSkillMentionExtension({
        getSkills: () => skillsRef.current,
      }),
      createInboxMentionExtension({
        getInboxes: () => inboxesRef.current,
      }),
    ];
  }, [placeholder]);

  const editor = useEditor({
    extensions,
    editable: !disabled,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class:
          'ProseMirror min-h-[36px] max-h-[160px] overflow-y-auto px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none selection:bg-indigo-500/30 font-normal leading-relaxed',
      },
      handleDOMEvents: {
        compositionstart: () => {
          isComposingRef.current = true;
          return false;
        },
        compositionend: () => {
          isComposingRef.current = false;
          return false;
        },
      },
      handleKeyDown: (view, event) => {
        // Invariant: Never submit if IME composition is active (e.g. Chinese Pinyin enter)
        if (event.isComposing || isComposingRef.current || event.keyCode === 229) {
          return false;
        }

        // When pressing Enter without Shift
        if (event.key === 'Enter' && !event.shiftKey) {
          // If any suggestion dropdown is active, let suggestion handle it
          if (editor && isAnySuggestionActive(editor)) {
            return false;
          }

          event.preventDefault();
          handleSubmit();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      const doc = serializeEditorContent(nextEditor);
      setHasContent(doc !== null);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  return {
    editor,
    hasContent,
    handleSubmit,
    clearContent: () => {
      editor?.commands.clearContent();
      setHasContent(false);
    },
  };
}
