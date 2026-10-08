import { useState, useEffect, useRef } from 'react';
import {
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { trpc } from '../../../utils/trpc.js';
import { useRuntime } from '../../../context/RuntimeContext.js';
import type { InboxProviderStatus } from '@rover/runtime/expose';

interface ConnectionFeedback {
  type: 'success' | 'error';
  message: string;
}

const STATUS_CONFIG: Record<
  InboxProviderStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  connected: {
    label: '已连接',
    badgeClass: 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60',
    dotClass: 'bg-emerald-400 animate-pulse',
  },
  connecting: {
    label: '连接中...',
    badgeClass: 'bg-amber-950/80 text-amber-400 border-amber-800/60',
    dotClass: 'bg-amber-400 animate-ping',
  },
  auth_failed: {
    label: '认证失败',
    badgeClass: 'bg-rose-950/80 text-rose-400 border-rose-800/60',
    dotClass: 'bg-rose-400',
  },
  disconnected: {
    label: '已断开',
    badgeClass: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    dotClass: 'bg-zinc-400',
  },
  disabled: {
    label: '未启用',
    badgeClass: 'bg-zinc-800/60 text-zinc-500 border-zinc-700/50',
    dotClass: 'bg-zinc-500',
  },
  error: {
    label: '运行异常',
    badgeClass: 'bg-rose-950/80 text-rose-400 border-rose-800/60',
    dotClass: 'bg-rose-400',
  },
};

export function WecomConfigCard() {
  const { wsClient } = useRuntime();
  const utils = trpc.useUtils();

  // 1. 读取当前配置
  const {
    data: config,
    isLoading,
    refetch,
  } = trpc.inbox.getWecomConfig.useQuery(undefined, {
    staleTime: 0,
  });

  // 2. 表单与交互状态
  const initializedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [botId, setBotId] = useState('');
  const [botSecret, setBotSecret] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [status, setStatus] = useState<InboxProviderStatus>('disabled');
  const [showSecret, setShowSecret] = useState(false);
  const [feedback, setFeedback] = useState<ConnectionFeedback | null>(null);

  // 初始化与远程配置同步（仅在首次获得远程数据时初始化）
  useEffect(() => {
    if (config && !initializedRef.current) {
      initializedRef.current = true;
      setEnabled(config.enabled);
      setBotId(config.botId || '');
      setBotSecret(config.botSecret || '');
      setWsUrl(config.wsUrl || '');
      setStatus((config.status as InboxProviderStatus) || 'disabled');
    }
  }, [config]);

  // 监听 WebSocket 实时状态广播
  useEffect(() => {
    if (!wsClient?.registerEventHandler) return;

    const unregister = wsClient.registerEventHandler({
      'inbox.provider.status': (payload: any) => {
        if (payload?.providerId === 'wecom' && payload.status) {
          setStatus(payload.status);
        }
      },
      'inbox.changed': () => {
        void utils.inbox.getWecomConfig.invalidate();
      },
    });

    return () => {
      unregister();
    };
  }, [wsClient, utils]);

  // 3. Mutations
  const updateMutation = trpc.inbox.updateWecomConfig.useMutation({
    onSuccess: (res) => {
      setFeedback({
        type: 'success',
        message: `配置已保存！${res.enabled ? '企业微信长连接服务已启动。' : '长连接已停止。'}`,
      });
      if (!showSecret) {
        setBotSecret(res.botSecret || '');
      }
      setStatus((res.status as InboxProviderStatus) || 'disabled');
      void utils.inbox.getWecomConfig.invalidate();
      void refetch();
    },
    onError: (err) => {
      setFeedback({
        type: 'error',
        message: `保存配置失败: ${err.message}`,
      });
    },
  });

  const testMutation = trpc.inbox.testWecomConnection.useMutation();

  // 4. 小眼睛明暗文切换
  const handleToggleEye = async () => {
    if (!showSecret) {
      // 准备查看明文：如果当前是掩码，向后台请求真实明文
      if (botSecret.includes('••••')) {
        try {
          const unmasked = await utils.client.inbox.getWecomConfig.query({ unmask: true });
          if (unmasked.botSecret) {
            setBotSecret(unmasked.botSecret);
          }
        } catch (e) {
          console.error('获取明文密钥失败:', e);
        }
      }
      setShowSecret(true);
    } else {
      setShowSecret(false);
    }
  };

  // 5. 测试握手
  const handleTestConnection = async () => {
    setFeedback(null);
    try {
      const res = await testMutation.mutateAsync({
        botId,
        botSecret,
        wsUrl: wsUrl.trim() || undefined,
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          message: `连接测试成功！握手往返延迟: ${res.latencyMs ?? 0}ms`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: `连接测试失败: ${res.error || '未知错误'}`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `测试异常: ${err.message || String(err)}`,
      });
    }
  };

  // 6. 保存配置
  const handleSave = async () => {
    setFeedback(null);
    await updateMutation.mutateAsync({
      enabled,
      botId: botId.trim(),
      botSecret: botSecret.trim(),
      wsUrl: wsUrl.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 text-center text-zinc-500 text-sm">
        <RefreshCw className="inline-block animate-spin w-5 h-5 mb-2 text-emerald-400" />
        <div>正在加载企业微信集成配置...</div>
      </div>
    );
  }

  const currentStatusBadge = STATUS_CONFIG[status] || STATUS_CONFIG.disabled;
  const isSaving = updateMutation.isPending;
  const isTesting = testMutation.isPending;

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 flex flex-col gap-5 shadow-sm">
      {/* 头部标题与开关 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold text-zinc-100">企业微信智能机器人</h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${currentStatusBadge.badgeClass}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${currentStatusBadge.dotClass}`} />
                {currentStatusBadge.label}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              通过 WebSocket 出站长连接直连企微网关，接收企业群与单聊 @bot 消息。
            </p>
          </div>
        </div>

        {/* 启用开关 Switch */}
        <div className="flex items-center gap-2 shrink-0 pt-1">
          <span className="text-xs text-zinc-400 font-medium">{enabled ? '已启用' : '已停用'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="启用企业微信集成"
            onClick={() => setEnabled((prev) => !prev)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              enabled ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 折叠表单区域 */}
      {enabled ? (
        <div className="space-y-4 pt-4 border-t border-zinc-800/80">
          {/* Bot ID */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wecom-bot-id" className="text-xs font-medium text-zinc-300">
              Bot ID <span className="text-rose-400">*</span>
            </label>
            <input
              id="wecom-bot-id"
              type="text"
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              placeholder="例如：bot_12345678"
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
            />
            <span className="text-[11px] text-zinc-500">
              企业微信管理后台中配置的机器人唯一标识。
            </span>
          </div>

          {/* Bot Secret */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wecom-bot-secret" className="text-xs font-medium text-zinc-300">
              Bot Secret <span className="text-rose-400">*</span>
            </label>
            <div className="relative flex items-center">
              <input
                id="wecom-bot-secret"
                type={showSecret ? 'text' : 'password'}
                value={botSecret}
                onChange={(e) => setBotSecret(e.target.value)}
                placeholder="例如：my_bot_secret_key"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-3 pr-10 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={handleToggleEye}
                aria-label={showSecret ? '隐藏密钥' : '显示密钥'}
                title={showSecret ? '隐藏密钥' : '显示密钥'}
                className="absolute right-2.5 p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
              <span>凭证安全保护：写入 ~/.rover/inbox.json 时采用 0600 严格权限。</span>
            </div>
          </div>

          {/* 网关地址（高级/可选） */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wecom-ws-url" className="text-xs font-medium text-zinc-400">
              WebSocket 网关地址 (可选)
            </label>
            <input
              id="wecom-ws-url"
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="默认: wss://work.weixin.qq.com/wework_robot/ws"
              className="bg-zinc-950 border border-zinc-700/60 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors font-mono text-[11px]"
            />
            <span className="text-[11px] text-zinc-500">
              留空默认直连官方网关；可在内网环境或单测中配置自定义 Mock/代理地址。
            </span>
          </div>

          {/* 反馈提示条 */}
          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/60 border-rose-800/80 text-rose-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span className="flex-1">{feedback.message}</span>
            </div>
          )}

          {/* 操作按钮栏 */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving || !botId || !botSecret}
              className="px-3.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-400" />}
              <span>{isTesting ? '正在测试...' : '测试连接'}</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />}
              <span>{isSaving ? '正在保存...' : '保存配置'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-500">
          <span>集成已处于停用状态，长连接保持断开。</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-3.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSaving ? '正在保存...' : '保存停用状态'}
          </button>
        </div>
      )}
    </div>
  );
}
