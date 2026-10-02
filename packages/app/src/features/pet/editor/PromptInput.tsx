import React from 'react';
import { EditorContent } from '@tiptap/react';
import { ArrowUp } from 'lucide-react';
import { usePromptEditor } from './usePromptEditor.js';
import type { PromptInputProps } from './types.js';

export function PromptInput({
  disabled = false,
  placeholder,
  autoFocus = true,
  onSubmit,
  availableAgents = [],
  availableSkills = [],
  availableInboxes = [],
  className = '',
}: PromptInputProps) {
  const { editor, hasContent, handleSubmit } = usePromptEditor({
    disabled,
    placeholder,
    autoFocus,
    onSubmit,
    availableAgents,
    availableSkills,
    availableInboxes,
  });

  return (
    <div
      className={`relative flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-2 backdrop-blur-xl shadow-2xl transition-all focus-within:border-zinc-700/80 focus-within:ring-1 focus-within:ring-zinc-700/50 ${
        disabled ? 'opacity-60 cursor-not-allowed' : ''
      } ${className}`}
      data-testid="prompt-input-container"
    >
      <div className="flex-1 min-w-0">
        <EditorContent editor={editor} />
      </div>

      <button
        type="button"
        disabled={!hasContent || disabled}
        onClick={handleSubmit}
        className={`shrink-0 mb-0.5 inline-flex items-center justify-center w-7 h-7 rounded-xl transition-all ${
          hasContent && !disabled
            ? 'bg-white text-zinc-950 hover:bg-zinc-200 shadow-sm active:scale-95'
            : 'bg-zinc-800/60 text-zinc-600 cursor-not-allowed'
        }`}
        title="发送 (Enter)"
        data-testid="prompt-submit-button"
      >
        <ArrowUp className="w-4 h-4 stroke-[2.5]" />
      </button>
    </div>
  );
}
