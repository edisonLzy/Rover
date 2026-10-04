import { useEffect, useRef, useState } from 'react';
import { SquarePen } from 'lucide-react';
import { PromptInput } from './PromptInput/index.js';
import type { PromptDocumentV1, SuggestionItemData } from './PromptInput/types.js';
import { Task } from './Task/index.js';
import { Inbox } from './Inbox/index.js';
import { PendingQueue, type PendingPromptItem } from './PendingQueue.js';

interface PetToolbarProps {
  petHovered: boolean;
  isBusy: boolean;
  submissionUnavailable: string | null;
  onSubmit: (doc: PromptDocumentV1) => Promise<void>;
}

const AGENTS: SuggestionItemData[] = [
  { id: 'claude-code', kind: 'agent', label: 'Claude Code', description: 'Anthropic Coding CLI' },
  { id: 'codex', kind: 'agent', label: 'Codex', description: 'OpenAI Code Generator' },
];
const SKILLS: SuggestionItemData[] = [
  {
    id: 'agent-dispatch',
    kind: 'skill',
    label: 'agent-dispatch',
    description: '派发 Coding Agent',
  },
  { id: 'task-recall', kind: 'skill', label: 'task-recall', description: '查询历史任务' },
];

export function PetToolbar({
  petHovered,
  isBusy,
  submissionUnavailable,
  onSubmit,
}: PetToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const queueSendingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeFeature, setActiveFeature] = useState<'none' | 'task' | 'inbox'>('none');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingQueue, setPendingQueue] = useState<PendingPromptItem[]>([]);
  const [queueDeferred, setQueueDeferred] = useState(false);
  const [queueSending, setQueueSending] = useState(false);

  useEffect(() => {
    if (petHovered || hovered || focused || hasDraft || submitError) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(activeFeature !== 'none' || pendingQueue.length > 0);
      setEditing(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [petHovered, hovered, focused, hasDraft, submitError, activeFeature, pendingQueue.length]);

  const handleSubmit = async (doc: PromptDocumentV1) => {
    setSubmitError(null);
    if (submissionUnavailable) {
      setSubmitError(submissionUnavailable);
      return false;
    }
    if (isBusy || queueSendingRef.current || pendingQueue.length) {
      const prefixes = { agent: '@', skill: '/', inbox: '#' };
      const preview = doc.parts
        .map((part) =>
          part.type === 'text'
            ? part.text
            : part.label.startsWith(prefixes[part.kind])
              ? part.label
              : `${prefixes[part.kind]}${part.label}`
        )
        .join('')
        .trim();
      setPendingQueue((items) => [
        ...items,
        { id: crypto.randomUUID(), doc, textSnippet: preview, createdAt: Date.now() },
      ]);
      setQueueDeferred(false);
      return true;
    }
    try {
      await onSubmit(doc);
      return true;
    } catch (failure: unknown) {
      setSubmitError(failure instanceof Error ? failure.message : '发送失败，请稍后重试');
      return false;
    }
  };

  const handleProceedNext = async () => {
    if (queueSendingRef.current || isBusy || submissionUnavailable || !pendingQueue.length) return;
    const item = pendingQueue[0];
    queueSendingRef.current = true;
    setQueueSending(true);
    setSubmitError(null);
    try {
      await onSubmit(item.doc);
      setPendingQueue((items) => items.filter((entry) => entry.id !== item.id));
      setQueueDeferred(false);
    } catch (failure: unknown) {
      setSubmitError(failure instanceof Error ? failure.message : '发送失败，请稍后重试');
    } finally {
      queueSendingRef.current = false;
      setQueueSending(false);
    }
  };

  return (
    <div
      ref={toolbarRef}
      hidden={!visible}
      tabIndex={-1}
      aria-label="宠物工具栏"
      className="pet-toolbar mt-[9px] grid grid-cols-[1fr_64px_64px_64px_1fr] gap-y-[10px] outline-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div
        hidden={editing}
        aria-hidden="true"
        className="compact-controls col-start-2 col-span-3 row-start-1 -mx-[4.5px] h-[58px] rounded-full bg-white shadow-[0_7px_20px_#172a4140]"
      />
      <button
        type="button"
        hidden={editing}
        aria-label="编辑 Prompt"
        className="pet-toolbar-trigger col-start-2"
        onClick={() => {
          setEditing(true);
          setSubmitError(null);
        }}
      >
        <SquarePen />
      </button>
      <Inbox controlsVisible={!editing} />
      <Task
        controlsVisible={!editing}
        active={activeFeature === 'task'}
        onToggle={() => setActiveFeature((feature) => (feature === 'task' ? 'none' : 'task'))}
      />
      <div hidden={!editing} className="col-span-5 row-start-1">
        <PromptInput
          autoFocus={editing && visible}
          placeholder="问 Rover，@ Agent，/ Skill，# Inbox"
          availableAgents={AGENTS}
          availableSkills={SKILLS}
          onContentChange={setHasDraft}
          onSubmit={handleSubmit}
          onAccepted={() => {
            setEditing(false);
            setSubmitError(null);
            toolbarRef.current?.focus();
          }}
        />
      </div>
      {submitError && (
        <p
          role="alert"
          className="col-span-5 rounded-[19px] bg-white/95 px-4 py-3 text-xs text-[#a45535]"
        >
          {submitError}
        </p>
      )}
      {!!pendingQueue.length && (
        <div className="col-span-5">
          <PendingQueue
            disabled={queueSending}
            queue={pendingQueue}
            onRemove={(id) => {
              if (!queueSendingRef.current)
                setPendingQueue((items) => items.filter((item) => item.id !== id));
            }}
            onConfirmNext={handleProceedNext}
            onDefer={() => setQueueDeferred(true)}
            isDeferred={queueDeferred}
            canProceed={!isBusy && !queueSending && !submissionUnavailable}
          />
        </div>
      )}
    </div>
  );
}
