import { useRef, useState } from 'react';
import type { InboxMessageRecord } from '@rover/runtime/expose';

interface InboxListProps {
  messages: InboxMessageRecord[];
  loading: boolean;
  error?: string;
  onHandoff: (message: InboxMessageRecord) => Promise<void>;
}

export function InboxList({ messages, loading, error, onHandoff }: InboxListProps) {
  const [handingOff, setHandingOff] = useState<string | null>(null);
  const lock = useRef(false);
  const handoff = async (message: InboxMessageRecord) => {
    if (lock.current) return;
    lock.current = true;
    setHandingOff(message.id);
    try {
      await onHandoff(message);
    } finally {
      lock.current = false;
      setHandingOff(null);
    }
  };
  return (
    <section id="pet-inbox-list" aria-label="Inbox 消息列表" className="panel-scroll event-list">
      {error && (
        <p role="alert" className="panel-error">
          {error}
        </p>
      )}
      {messages.map((message) => (
        <article key={message.id} className="event-card">
          <div className="event-meta">
            <span className="event-kind">
              {message.kind === 'alert' ? '告警' : message.kind === 'event' ? '事件' : '消息'}
            </span>
            <time dateTime={new Date(message.occurredAt).toISOString()}>
              {new Date(message.occurredAt).toLocaleString()}
            </time>
          </div>
          <h3 className="event-title">{message.title}</h3>
          {message.summary && <p className="event-summary">{message.summary}</p>}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="event-handoff"
              disabled={!!handingOff}
              onClick={() => {
                void handoff(message);
              }}
            >
              {handingOff === message.id ? '正在交办…' : '交由 Rover 处理 ↗'}
            </button>
          </div>
        </article>
      ))}
      {!messages.length && (
        <p className="panel-empty">{loading ? '正在读取消息…' : '目前没有待处理消息'}</p>
      )}
    </section>
  );
}
