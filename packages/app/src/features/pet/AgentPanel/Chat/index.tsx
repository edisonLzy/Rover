import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { ProcessingView } from './ProcessingView.js';
import type { useConversation } from './useConversation.js';

export { useConversation } from './useConversation.js';

interface ChatProps {
  conversation: ReturnType<typeof useConversation>;
  search: string;
  visible?: boolean;
}

export function Chat({ conversation, search, visible = true }: ChatProps) {
  const scrollRef = useRef<HTMLElement>(null);
  const nearBottom = useRef(true);
  const previous = useRef({ firstId: '', lastText: '', height: 0 });
  const firstId = conversation.messages[0]?.id ?? '';
  const lastText = conversation.messages.at(-1)?.text ?? '';
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !visible) return;
    const before = previous.current;
    if (before.firstId && before.firstId !== firstId && before.lastText === lastText) {
      scroll.scrollTop += scroll.scrollHeight - before.height;
    } else if (nearBottom.current) scroll.scrollTop = scroll.scrollHeight;
    previous.current = { firstId, lastText, height: scroll.scrollHeight };
  }, [firstId, lastText, conversation.processing, visible]);
  const messages = conversation.messages.filter((message) =>
    message.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  return (
    <section
      ref={scrollRef}
      aria-label="Rover 对话"
      className="panel-scroll chat-messages"
      onScroll={(event) => {
        const element = event.currentTarget;
        nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 50;
      }}
    >
      {conversation.hasOlder && (
        <button
          type="button"
          className="load-history"
          disabled={conversation.loadingOlder}
          onClick={() => {
            void conversation.loadOlder();
          }}
        >
          {conversation.loadingOlder ? '正在读取…' : '加载更早的对话'}
        </button>
      )}
      {conversation.historyError && (
        <div role="alert" className="panel-error">
          {conversation.historyError}
          <button
            type="button"
            onClick={() => {
              void conversation.retry();
            }}
          >
            重试
          </button>
        </div>
      )}
      {!messages.length && (
        <div className="panel-empty">
          <Sparkles size={28} strokeWidth={1.25} />
          <h2>
            {search
              ? '没有匹配的对话'
              : conversation.loading
                ? '正在读取对话…'
                : '有什么想一起完成的？'}
          </h2>
          <p>{search ? '试试其他关键词。' : '提一个问题，或把下一件事交给 Rover。'}</p>
        </div>
      )}
      {messages.map((message) => (
        <article
          key={message.id}
          className={`chat-message ${message.role}${message.isError ? ' message-error' : ''}`}
        >
          <div className="message-meta">
            <span>{message.role === 'user' ? '你' : 'Rover'}</span>
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
          <p>{message.text}</p>
        </article>
      ))}
      <ProcessingView
        state={conversation.processing}
        resolving={conversation.resolving}
        error={conversation.approvalError}
        onApprove={() => {
          void conversation.approve();
        }}
        onDeny={() => {
          void conversation.deny();
        }}
      />
    </section>
  );
}
