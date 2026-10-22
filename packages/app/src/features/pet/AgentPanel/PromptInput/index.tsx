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
  onAccepted,
  onEscape,
  availableAgents = [],
  availableSkills = [],
  availableInboxes = [],
  className = '',
  onContentChange,
}: PromptInputProps) {
  const { editor, hasContent, isSubmitting, handleSubmit } = usePromptEditor({
    disabled,
    placeholder,
    autoFocus,
    onSubmit,
    onAccepted,
    onEscape,
    availableAgents,
    availableSkills,
    availableInboxes,
  });
  const handleContainerClick = (event: MouseEvent) => {
    if (!(event.target as HTMLElement).closest('button') && editor && !disabled)
      editor.commands.focus('end');
  };
  useEffect(() => {
    onContentChange?.(hasContent);
  }, [hasContent, onContentChange]);
  return (
    <div
      onClick={handleContainerClick}
      className={`pet-composer ${className}`}
      data-testid="prompt-input-container"
    >
      <div className="pet-editor-content min-w-0 flex-1">
        <EditorContent editor={editor} />
      </div>
      <button
        type="button"
        disabled={!hasContent || disabled || isSubmitting}
        onClick={handleSubmit}
        className="pet-send"
        title="发送 (Enter)"
        aria-label="发送给 Rover"
        data-testid="prompt-submit-button"
      >
        <ArrowUp size={22} />
      </button>
    </div>
  );
}
