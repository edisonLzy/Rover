import { WecomConfigCard } from './WecomConfigCard.js';
import { Radio, ShieldAlert } from 'lucide-react';

export function InboxSettingsView() {
  return (
    <div className="flex flex-col gap-6">
      {/* 顶部标题与说明 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-100">消息集成 (Inbox Integrations)</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono">
            M3 Gateway
          </span>
        </div>
        <p className="text-xs text-zinc-400">
          通过安全出站长连接被动接收企业微信等外部平台事件与 @ 消息；消息到达仅入库并不消耗模型
          Token，交办后受控注入 Rover 进行故障排查。
        </p>
      </div>

      {/* 企业微信配置卡片 */}
      <WecomConfigCard />

      {/* 拓展支持占位卡片 (飞书 / 钉钉) */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-5 flex items-center justify-between opacity-60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-zinc-300">飞书 / 钉钉智能机器人</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                敬请期待
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              后续将扩展基于双向 WebSocket 的飞书与钉钉自定义机器人事件接入。
            </p>
          </div>
        </div>
      </div>

      {/* 安全与防注入合规提示 */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 flex items-start gap-3 text-xs text-zinc-400">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-medium text-zinc-300">外部消息防注入隔离保证</div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            所有来自企微等外部渠道的消息在 Rover 中均仅作为「事实数据块 (External
            Evidence)」受控读取，绝不允许直接覆盖系统指令，保障本机系统安全。
          </p>
        </div>
      </div>
    </div>
  );
}

export { WecomConfigCard };
