import type { PromptDocumentV1, PromptReferenceKind } from '@rover/runtime/expose';
export type { PromptDocumentV1, PromptReferenceKind };

export type MentionKind = PromptReferenceKind;

export interface SuggestionItemData {
  id: string;
  kind: MentionKind;
  label: string;
  description?: string;
  detail?: string;
}

export interface PromptInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (doc: PromptDocumentV1) => Promise<void | boolean> | void | boolean;
  onAccepted?: () => void;
  availableAgents?: SuggestionItemData[];
  availableSkills?: SuggestionItemData[];
  availableInboxes?: SuggestionItemData[];
  className?: string;
  autoFocus?: boolean;
  onContentChange?: (hasContent: boolean) => void;
}
