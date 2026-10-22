import type { InboxMessageRecord } from '@rover/runtime/expose';
import { useRuntime } from '../../../../context/RuntimeContext.js';
import { trpc } from '../../../../utils/trpc.js';
import type { SuggestionItemData } from '../PromptInput/types.js';
import { InboxList } from './list.js';

interface InboxProps {
  search: string;
  onHandoff: (message: InboxMessageRecord) => Promise<void>;
}

function useInboxMessages() {
  const { connection } = useRuntime();
  return trpc.inbox.list.useQuery(
    { limit: 100, status: 'all' },
    { enabled: !!connection, refetchInterval: 5000 }
  );
}

export function useInboxUnreadCount() {
  const { connection } = useRuntime();
  const count = trpc.inbox.getUnreadCount.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 5000,
  });
  return count.data ?? 0;
}

function getActionableMessages(messages: InboxMessageRecord[]) {
  return messages.filter((message) => message.status === 'unread' || message.status === 'read');
}

export function useInboxSuggestions(): SuggestionItemData[] {
  const messages = useInboxMessages();
  return getActionableMessages(messages.data ?? []).map((message) => ({
    id: message.id,
    kind: 'inbox',
    label: message.title,
    description: message.summary ?? undefined,
  }));
}

export function useInboxDelegation() {
  const queryUtils = trpc.useUtils();
  const markAsDelegated = trpc.inbox.markAsDelegated.useMutation();

  return async (messageId: string) => {
    const result = await markAsDelegated.mutateAsync({ id: messageId });
    if (!result.success) throw new Error('消息状态更新失败');

    await Promise.all([
      queryUtils.inbox.list.invalidate(),
      queryUtils.inbox.getUnreadCount.invalidate(),
    ]);
  };
}

export function Inbox({ search, onHandoff }: InboxProps) {
  const { connection } = useRuntime();
  const messages = useInboxMessages();
  const actionableMessages = getActionableMessages(messages.data ?? []).filter((message) =>
    [message.title, message.summary]
      .join(' ')
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  );
  return (
    <div className="panel-section">
      <div className="panel-section-heading">
        <h1>Events</h1>
        <p>外部消息与通知，需要时交给 Rover。</p>
      </div>
      <InboxList
        messages={actionableMessages}
        loading={messages.isPending && !!connection}
        error={messages.error?.message}
        onHandoff={onHandoff}
      />
    </div>
  );
}
