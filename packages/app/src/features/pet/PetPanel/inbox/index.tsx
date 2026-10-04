import { useInbox } from './useInbox.js';
import { usePetRuntime } from '../../runtime/index.js';
import type { PendingInboxItem } from './store.js';

export function InboxList() {
  const { items } = useInbox();
  return <section aria-label="Inbox 列表" className="grid gap-[10px]">
    {items.length === 0 ? <p className="rounded-[27px] bg-white/95 px-5 py-5 text-xs text-[#657993]">Inbox 暂无待处理消息</p>
      : items.map((item) => <InboxItem key={item.id} item={item} />)}
  </section>;
}

function InboxItem({ item }: { item: PendingInboxItem }) {
  const { confirm, remove } = useInbox();
  const { isOnline, hasActiveModel } = usePetRuntime();
  return <article className="rounded-[27px] border border-[#dce8fa] bg-white/95 px-5 py-[17px] text-[#374c66] shadow-[0_7px_20px_#1f344b17]">
    <div className="mb-2 flex items-center justify-between text-[10px] text-[#657993]">
      <span>待处理 Prompt · {item.mode === 'immediate' ? '立即发送' : '等待确认'}</span>
      <button type="button" disabled={item.status === 'sending'} onClick={() => remove(item.id)} aria-label={`移除 ${item.preview}`} className="rounded-full px-2 py-1 hover:bg-[#edf3ff] disabled:opacity-40">移除</button>
    </div>
    <p className="select-text text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{item.preview}</p>
    {item.error && <p role="alert" className="mt-2 text-xs text-[#a45535]">{item.error}</p>}
    <button type="button" onClick={() => void confirm(item.id)} disabled={!isOnline || !hasActiveModel || item.status === 'sending'} className="mt-3 rounded-full bg-[#3479ed] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40">
      {item.status === 'sending' ? '发送中…' : item.status === 'failed' ? '重试发送' : '确认发送'}
    </button>
  </article>;
}
