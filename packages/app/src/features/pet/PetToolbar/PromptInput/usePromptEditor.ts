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
  onAccepted?: () => void;
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
    onAccepted,
    availableAgents = [],
    availableSkills = [],
    availableInboxes = [],
  } = options;

  const [hasContent, setHasContent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const isComposingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const agentsRef = useRef(availableAgents);
  const skillsRef = useRef(availableSkills);
  const inboxesRef = useRef(availableInboxes);
  const onSubmitRef = useRef(onSubmit);
  const onAcceptedRef = useRef(onAccepted);

  useEffect(() => {
    agentsRef.current = availableAgents;
    skillsRef.current = availableSkills;
    inboxesRef.current = availableInboxes;
    onSubmitRef.current = onSubmit;
    onAcceptedRef.current = onAccepted;
  }, [availableAgents, availableSkills, availableInboxes, onSubmit, onAccepted]);

  const handleSubmit = useCallback(async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || disabled || submittingRef.current) return;

    const doc = serializeEditorContent(currentEditor);
    if (!doc) return;

    const submittedContent = currentEditor.state.doc;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await onSubmitRef.current(doc);
      if (result === false) {
        return;
      }
      if (currentEditor.isDestroyed) return;
      if (!currentEditor.state.doc.eq(submittedContent)) return;
      currentEditor.commands.clearContent();
      setHasContent(false);
      onAcceptedRef.current?.();
    } catch {
      // Keep editor content on submission error so user doesn't lose text
    } finally {
      submittingRef.current = false;
      if (!currentEditor.isDestroyed) setIsSubmitting(false);
    }
  }, [disabled]);

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
        role: 'textbox',
        'aria-label': '问 Rover 或交办任务',
        'aria-multiline': 'true',
        class:
          'ProseMirror min-h-6 max-h-[100px] overflow-y-auto p-0 text-base font-medium leading-normal text-[#232934] outline-none selection:bg-[#d9e6ff] select-text cursor-text [&_p]:m-0 [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:text-[#b3b6bd]',
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
          const agentSuggestion = agentSuggestionPluginKey.getState(view.state);
          const skillSuggestion = skillSuggestionPluginKey.getState(view.state);
          const inboxSuggestion = inboxSuggestionPluginKey.getState(view.state);
          if (agentSuggestion?.active || skillSuggestion?.active || inboxSuggestion?.active) {
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
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!disabled && !isSubmitting);
      if (!disabled && !isSubmitting && autoFocus) {
        editor.commands.focus('end');
      }
    }
  }, [disabled, editor, autoFocus, isSubmitting]);

  useEffect(() => {
    if (autoFocus && editor && !disabled) {
      const timer = setTimeout(() => {
        if (!editor.isDestroyed) {
          editor.commands.focus('end');
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [editor, autoFocus, disabled]);

  return {
    editor,
    hasContent,
    isSubmitting,
    handleSubmit,
    clearContent: () => {
      editor?.commands.clearContent();
      setHasContent(false);
    },
  };
}
