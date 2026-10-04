import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Inbox, SquarePen } from 'lucide-react';
import { PromptInput } from '../editor/PromptInput.js';
import type { SuggestionItemData } from '../editor/types.js';
import { usePetRuntime } from '../runtime/index.js';
import { useInbox } from '../PetPanel/inbox/useInbox.js';
import type { InboxMode } from '../PetPanel/inbox/store.js';
import { useTasks } from '../PetPanel/tasks/useTasks.js';
import type { ActivePanelProps } from '../PetPanel/useActivePanel.js';

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
  activePanel,
  toggleInbox,
  toggleTask,
}: ActivePanelProps & { petHovered: boolean }) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<InboxMode>('immediate');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { isOnline, hasActiveModel } = usePetRuntime();
  const { items, add } = useInbox();
  const tasks = useTasks();
  useEffect(() => {
    if (petHovered || hovered || focused || hasDraft || activePanel !== 'none') {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(false);
      setEditing(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [petHovered, hovered, focused, hasDraft, activePanel]);
  if (!visible) return null;
  return (
    <div
      ref={toolbar}
      tabIndex={-1}
      className="pet-toolbar mt-[9px] shrink-0 outline-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {editing ? (
        <>
          <PromptInput
            autoFocus
            placeholder="问 Rover，@ Agent，/ Skill，# Inbox"
            availableAgents={AGENTS}
            availableSkills={SKILLS}
            onContentChange={setHasDraft}
            onSubmit={(doc) => {
              if (mode === 'immediate' && (!isOnline || !hasActiveModel)) {
                setSubmitError(
                  !isOnline ? 'Runtime 离线，请稍后重试' : '请到 Dashboard 配置激活模型'
                );
                return false;
              }
              add(doc, mode);
              toolbar.current?.focus();
              setHasDraft(false);
              setEditing(false);
              setSubmitError(null);
              return true;
            }}
          />
          <div className="mt-2 flex items-center justify-between px-3 text-[10px] text-[#657993]">
            <label className="rounded-full bg-white/95 px-3 py-1">
              输入处理方式{' '}
              <select
                aria-label="输入处理方式"
                value={mode}
                onChange={(event) => setMode(event.target.value as InboxMode)}
                className="ml-1 bg-transparent outline-none"
              >
                <option value="immediate">立即发送</option>
                <option value="suspended">暂存 Inbox</option>
              </select>
            </label>
            {submitError && (
              <span role="alert" className="rounded-full bg-white/95 px-3 py-1 text-[#a45535]">
                {submitError}
              </span>
            )}
          </div>
        </>
      ) : (
        <div
          aria-label="快捷操作工具栏"
          className="compact-controls mx-auto flex h-[58px] w-[201px] items-center justify-center rounded-full bg-white shadow-[0_7px_20px_#172a4140] [&>button]:relative [&>button]:grid [&>button]:h-[39px] [&>button]:w-[64px] [&>button]:place-items-center [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-[#252c34] [&>button:hover]:text-[#3479ed] [&>button+button]:border-l [&>button+button]:border-[#e6e8ec] [&_svg]:size-[22px]"
        >
          <button
            type="button"
            aria-label="编辑 Prompt"
            onClick={() => {
              setEditing(true);
              setSubmitError(null);
            }}
          >
            <SquarePen />
          </button>
          <button
            type="button"
            aria-label="Inbox"
            aria-expanded={activePanel === 'inbox'}
            onClick={toggleInbox}
          >
            <Inbox />
            <CountBadge count={items.length} />
          </button>
          <button
            type="button"
            aria-label="任务"
            aria-expanded={activePanel === 'task'}
            onClick={toggleTask}
          >
            {activePanel === 'task' ? <ChevronDown /> : <Bell />}
            <CountBadge count={tasks.data?.length ?? 0} />
          </button>
        </div>
      )}
    </div>
  );
}

function CountBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="absolute -top-px right-[7px] grid h-[21px] min-w-[21px] place-items-center rounded-full border-2 border-white bg-[#37c56b] px-1 text-[10px] font-bold text-white">
      {count}
    </span>
  );
}
