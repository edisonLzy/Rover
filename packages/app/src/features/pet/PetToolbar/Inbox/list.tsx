import type { InboxMessageRecord } from '@rover/runtime/expose';

interface InboxListProps {
  messages: InboxMessageRecord[];
  loading: boolean;
  error?: string;
  onHandoff: (message: InboxMessageRecord) => void;
}

export function InboxList({ messages, loading, error, onHandoff }: InboxListProps) {
  return (
    <section
      id="pet-inbox-list"
      aria-label="Inbox 消息列表"
      className="pet-feature-list col-span-5 grid gap-[10px]"
    >
      {error && (
        <p role="alert" className="rounded-[19px] bg-white/95 px-4 py-3 text-xs text-[#a45535]">
          {error}
        </p>
      )}
      {messages.map((message) => (
        <article
          key={message.id}
          className="rounded-[27px] border-2 border-[#dce7ed] bg-[#fffffff4] px-5 py-[17px] shadow-[0_7px_20px_#1f344b17]"
        >
          <div className="flex items-center justify-between gap-2 text-[10px] text-[#72849b]">
            <span className="rounded-full bg-[#edf3ff] px-2 py-1 font-semibold text-[#3266ba]">
              {message.kind === 'alert' ? '告警' : message.kind === 'event' ? '事件' : '消息'}
            </span>
            <time dateTime={new Date(message.occurredAt).toISOString()}>
              {new Date(message.occurredAt).toLocaleString()}
            </time>
          </div>
          <h3 className="mt-2 text-[15px] leading-[1.4] font-[750] text-[#292f39] [overflow-wrap:anywhere]">
            {message.title}
          </h3>
          {message.summary && (
            <p className="mt-2 text-[11px] leading-normal text-[#586a7e] [overflow-wrap:anywhere]">
              {message.summary}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="rounded-full border-0 bg-[#3479ed] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#2067dd]"
              onClick={() => onHandoff(message)}
            >
              交由 Rover 处理 ↗
            </button>
          </div>
        </article>
      ))}
      {!messages.length && (
        <p className="rounded-[27px] bg-white/95 px-5 py-5 text-xs text-[#657993]">
          {loading ? '正在读取消息…' : '目前没有待处理消息'}
        </p>
      )}
    </section>
  );
}
