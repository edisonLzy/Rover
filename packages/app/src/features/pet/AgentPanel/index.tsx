import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { InboxMessageRecord } from '@rover/runtime/expose';
import {
  Inbox,
  useInboxDelegation,
  useInboxSuggestions,
  useInboxUnreadCount,
} from './Inbox/index.js';
import { PromptInput } from './PromptInput/index.js';
import type { PromptDocumentV1, SuggestionItemData } from './PromptInput/types.js';
import { Task } from './Task/index.js';
import { Chat, type useConversation } from './Chat/index.js';
import { FollowUpShelf } from './FollowUpShelf.js';
import type { useFollowUps } from '../useFollowUps.js';

interface AgentPanelProps {
  expanded: boolean;
  isBusy: boolean;
  scale: number;
  conversation: ReturnType<typeof useConversation>;
  followUps: ReturnType<typeof useFollowUps>;
  submissionUnavailable: string | null;
  onSubmit: (doc: PromptDocumentV1) => Promise<void>;
  onCollapse: () => void;
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
const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'task', label: 'Tasks' },
  { id: 'inbox', label: 'Events' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function AgentPanel({
  expanded,
  isBusy,
  scale,
  conversation,
  followUps,
  submissionUnavailable,
  onSubmit,
  onCollapse,
}: AgentPanelProps) {
  const [tab, setTab] = useState<Tab>('chat');
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const delegate = useInboxDelegation();
  const unread = useInboxUnreadCount();
  const inboxes = useInboxSuggestions();
  useEffect(() => {
    if (expanded && searching) searchRef.current?.focus();
  }, [expanded, searching]);
  const submit = async (doc: PromptDocumentV1) => {
    setSubmitError(null);
    if (submissionUnavailable) {
      setSubmitError(submissionUnavailable);
      return false;
    }
    try {
      await (isBusy || followUps.items.length ? followUps.enqueue(doc) : onSubmit(doc));
      return true;
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : '发送失败，请稍后重试');
      return false;
    }
  };
  const handoff = async (message: InboxMessageRecord) => {
    const accepted = await submit({
      v: 1,
      parts: [
        { type: 'text', text: '请读取并处理这条 Inbox 消息：' },
        { type: 'reference', kind: 'inbox', id: message.id, label: `#${message.title}` },
      ],
    });
    if (!accepted) return;
    setTab('chat');
    try {
      await delegate(message.id);
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : '交办状态更新失败');
    }
  };
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.id === tab);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index + TABS.length - 1) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`panel-tab-${TABS[next].id}`)?.focus();
  };
  return (
    <section
      id="pet-agent-panel"
      hidden={!expanded}
      className="agent-panel"
      aria-label="Rover Agent Panel"
    >
      <header className="panel-header">
        <button
          type="button"
          className="panel-search-toggle"
          aria-label={searching ? '关闭搜索' : '搜索'}
          aria-expanded={searching}
          onClick={() => {
            setSearching(!searching);
            setSearch('');
          }}
        >
          {searching ? <X size={17} /> : <Search size={17} />}
        </button>
        <div role="tablist" aria-label="面板导航" className="panel-tabs" onKeyDown={navigateTabs}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`panel-tab-${item.id}`}
              aria-controls={`panel-view-${item.id}`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === 'inbox' && unread > 0 && (
                <span className="tab-notification" aria-label={`${unread} 条未读消息`} />
              )}
              {item.id === 'chat' && conversation.hasApproval && (
                <span className="tab-notification attention" aria-label="有待审批请求" />
              )}
            </button>
          ))}
        </div>
      </header>
      {searching && (
        <div className="panel-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索当前已加载内容"
            aria-label="搜索当前面板"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setSearching(false);
                setSearch('');
                document.querySelector<HTMLButtonElement>('.panel-search-toggle')?.focus();
              }
            }}
          />
        </div>
      )}
      <div
        id="panel-view-chat"
        role="tabpanel"
        aria-labelledby="panel-tab-chat"
        hidden={tab !== 'chat'}
        className="panel-view"
      >
        <Chat conversation={conversation} search={search} visible={expanded && tab === 'chat'} />
      </div>
      <div
        id="panel-view-task"
        role="tabpanel"
        aria-labelledby="panel-tab-task"
        hidden={tab !== 'task'}
        className="panel-view"
      >
        <Task search={search} />
      </div>
      <div
        id="panel-view-inbox"
        role="tabpanel"
        aria-labelledby="panel-tab-inbox"
        hidden={tab !== 'inbox'}
        className="panel-view"
      >
        <Inbox search={search} onHandoff={handoff} />
      </div>
      <footer className="panel-footer">
        <FollowUpShelf
          scale={scale}
          items={followUps.items}
          highlightedId={followUps.highlightedId}
          disabled={followUps.syncing || !!followUps.startingId}
          canAdvance={followUps.canAdvance}
          onRemove={followUps.remove}
          onReorder={followUps.reorder}
          onAdvance={followUps.advance}
        />
        {(submitError || followUps.error) && (
          <p role="alert" className="panel-error">
            {submitError || followUps.error}
          </p>
        )}
        <PromptInput
          autoFocus={expanded && !searching}
          placeholder={isBusy ? '给 Rover 留下下一件事…' : 'Message Rover…'}
          availableAgents={AGENTS}
          availableSkills={SKILLS}
          availableInboxes={inboxes}
          onSubmit={submit}
          onEscape={onCollapse}
          onAccepted={() => setSubmitError(null)}
        />
        <div className="composer-hint">
          <span>
            {submissionUnavailable ||
              (isBusy
                ? 'Rover 正在处理 · 发送后接续执行'
                : '问 Rover · @ Agent · / Skill · # Inbox')}
          </span>
        </div>
      </footer>
    </section>
  );
}
