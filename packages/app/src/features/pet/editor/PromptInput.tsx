import { useEffect, type MouseEvent } from 'react';
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
  onContentChange,
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
  const handleContainerClick = (event: MouseEvent) => {
    if (!(event.target as HTMLElement).closest('button') && editor && !disabled)
      editor.commands.focus('end');
  };
  useEffect(() => { onContentChange?.(hasContent); }, [hasContent, onContentChange]);
  return (
    <div
      onClick={handleContainerClick}
      className={`pet-composer flex min-h-[60px] cursor-text items-center gap-2 rounded-[30px] bg-white pl-5 pr-[10px] py-[7px] shadow-[0_5px_17px_#1e314115] focus-within:shadow-[0_0_0_3px_#d9e6ff,0_5px_17px_#1e314115] ${className}`}
      data-testid="prompt-input-container"
    >
      <div className="pet-editor-content min-w-0 flex-1">
        <EditorContent editor={editor} />
      </div>
      <button
        type="button"
        disabled={!hasContent || disabled}
        onClick={handleSubmit}
        className="pet-circle-btn pet-send grid size-[42px] shrink-0 place-items-center rounded-full border-0 bg-[#3479ed] p-0 text-white hover:bg-[#2266d9] disabled:opacity-50"
        title="发送 (Enter)"
        aria-label="发送给 Rover"
        data-testid="prompt-submit-button"
      >
        <ArrowUp size={22} />
      </button>
    </div>
  );
}
