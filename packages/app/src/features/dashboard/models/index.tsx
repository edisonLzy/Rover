import { useState } from 'react';
import {
  Sparkles,
  Cpu,
  Trash2,
  RefreshCw,
  FileDown,
  Key,
  Globe,
  CheckCircle2,
  AlertCircle,
  Check,
} from 'lucide-react';
import { trpc } from '../../../utils/trpc.js';
import type { ActiveModelConfig, MaskedProviderConfig } from '@rover/runtime/expose';
import { AddProviderModal } from './AddProviderModal.js';
import { AddModelModal } from './AddModelModal.js';

export function ModelsView() {
  const utils = trpc.useUtils();
  const { data: config, isLoading, error, refetch } = trpc.models.getConfig.useQuery(undefined, {
    staleTime: 0,
  });
  const { data: piInfo } = trpc.models.checkPiAvailability.useQuery();

  const setActiveMutation = trpc.models.setActive.useMutation({
    onSuccess: () => {
      refetch();
      utils.models.invalidate();
    },
  });
  const deleteProviderMutation = trpc.models.deleteProvider.useMutation({
    onSuccess: () => {
      refetch();
      utils.models.invalidate();
    },
  });
  const deleteModelMutation = trpc.models.deleteModel.useMutation({
    onSuccess: () => {
      refetch();
      utils.models.invalidate();
    },
  });
  const importFromPiMutation = trpc.models.importFromPi.useMutation({
    onSuccess: (res) => {
      refetch();
      utils.models.invalidate();
      setNotice(
        `成功从 Pi CLI 导入 ${res.importedProviders.length} 个提供商，共 ${res.totalModels} 个模型！`
      );
      setTimeout(() => setNotice(null), 5000);
    },
    onError: (err) => {
      setNotice(`导入失败: ${err.message}`);
      setTimeout(() => setNotice(null), 5000);
    },
  });

  const testConnectionMutation = trpc.models.testConnection.useMutation();

  const [testingModelKey, setTestingModelKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; latencyMs?: number; error?: string }>
  >({});
  const [notice, setNotice] = useState<string | null>(null);

  const handleTest = async (providerId: string, modelId: string) => {
    const key = `${providerId}:${modelId}`;
    setTestingModelKey(key);
    try {
      const res = await testConnectionMutation.mutateAsync({
        provider: providerId,
        model: modelId,
      });
      setTestResults((prev) => ({
        ...prev,
        [key]: { success: res.success, latencyMs: res.latencyMs, error: res.error },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [key]: { success: false, error: (err as Error).message },
      }));
    } finally {
      setTestingModelKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center text-zinc-500 text-sm">
        <RefreshCw className="inline-block animate-spin w-5 h-5 mb-2 text-emerald-400" />
        <div>正在加载模型配置 (~/.rover/models.json)...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-5 text-sm">
        <div className="font-semibold text-rose-400 mb-1">加载配置失败</div>
        <p className="text-zinc-400 text-xs">{error.message}</p>
      </div>
    );
  }

  const providers = Object.entries(config?.providers || {}) as [string, MaskedProviderConfig][];
  const active = config?.active as ActiveModelConfig | undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* Notice Banner */}
      {notice && (
        <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center justify-between shadow-md">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-emerald-400 hover:text-emerald-200 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Pi Importer Banner (if Pi models.json is available on system) */}
      {piInfo?.available && (
        <div className="rounded-xl border border-indigo-900/60 bg-indigo-950/30 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <FileDown className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-zinc-200">
                检测到本机已安装 Pi CLI 模型配置
              </div>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                可一键安全导入 <code className="font-mono text-zinc-300">{piInfo.path}</code>{' '}
                中的模型与密钥到 Rover。
              </p>
            </div>
          </div>
          <button
            onClick={() => importFromPiMutation.mutate({})}
            disabled={importFromPiMutation.isPending}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {importFromPiMutation.isPending ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5" />
            )}
            <span>一键导入</span>
          </button>
        </div>
      )}

      {/* Active Model Hero Card */}
      <div className="rounded-xl border border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-900/60 p-5 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              当前 Rover 激活模型
            </span>
          </div>
          {/* 内聚触发的添加提供商弹窗 */}
          <AddProviderModal />
        </div>

        <div className="mt-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {active ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white font-mono">{active.model}</span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/60 text-[10px] font-mono">
                  {active.provider}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                此模型将由 Rover Agent 回合引擎优先调度用于意图解析、工具规划与对话响应。
              </p>
            </div>
          ) : (
            <div className="text-xs text-amber-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>尚未设定激活模型，请在下方提供商列表中选择一个模型设为默认。</span>
            </div>
          )}
        </div>
      </div>

      {/* Providers List */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">已配置提供商 ({providers.length})</h2>
          <span className="text-[11px] text-zinc-500 font-mono">
            配置持久化于 ~/.rover/models.json (0600)
          </span>
        </div>

        {providers.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-zinc-500 text-xs">
            暂无模型提供商配置，请点击上方「添加提供商」或一键从 Pi CLI 导入。
          </div>
        ) : (
          providers.map(([providerId, provider]) => (
            <div
              key={providerId}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 flex flex-col gap-3 shadow-xs"
            >
              {/* Provider Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-zinc-800/60">
                <div className="flex items-center gap-2.5">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-bold text-zinc-100 font-mono">{providerId}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      provider.api === 'anthropic-messages'
                        ? 'bg-indigo-950 text-indigo-400 border border-indigo-800/60'
                        : 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                    }`}
                  >
                    {provider.api}
                  </span>
                  <AddModelModal providerId={providerId} />
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px]">
                    <Globe className="w-3 h-3 text-zinc-500" />
                    <span className="truncate max-w-[200px]" title={provider.baseUrl}>
                      {provider.baseUrl}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[11px]">
                    <Key className="w-3 h-3 text-zinc-500" />
                    <span className="truncate max-w-[140px] text-zinc-400">
                      {provider.apiKey || '(无密钥)'}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        provider.hasKey ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                      title={provider.hasKey ? '密钥已就绪' : '未检测到有效密钥'}
                    />
                  </div>

                  <button
                    onClick={() => {
                      if (confirm(`确定要移除提供商 "${providerId}" 吗？`)) {
                        deleteProviderMutation.mutate({ id: providerId });
                      }
                    }}
                    className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                    title="删除提供商"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Models List in Provider */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                {(provider.models || []).map((model) => {
                  const isActive = active?.provider === providerId && active?.model === model.id;
                  const testKey = `${providerId}:${model.id}`;
                  const isTesting = testingModelKey === testKey;
                  const testResult = testResults[testKey];

                  return (
                    <div
                      key={model.id}
                      className={`rounded-lg border p-3 flex flex-col justify-between gap-2 transition-all ${
                        isActive
                          ? 'border-emerald-700/80 bg-emerald-950/20 shadow-sm'
                          : 'border-zinc-800 bg-zinc-950/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-zinc-200 font-mono">
                            {model.name || model.id}
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                            ID: {model.id}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400 font-mono">
                            {Math.round(model.contextWindow / 1000)}k ctx
                          </span>
                          {model.reasoning && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-950 text-[10px] text-purple-400 border border-purple-800/60 font-mono">
                              R1
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-zinc-900 gap-2">
                        {/* Ping Result badge */}
                        <div className="text-[11px] font-mono min-w-0">
                          {isTesting ? (
                            <span className="text-zinc-400 flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
                              <span>探测中...</span>
                            </span>
                          ) : testResult ? (
                            testResult.success ? (
                              <span className="text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{testResult.latencyMs}ms</span>
                              </span>
                            ) : (
                              <span
                                className="text-rose-400 flex items-center gap-1 truncate"
                                title={testResult.error}
                              >
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span className="truncate">{testResult.error}</span>
                              </span>
                            )
                          ) : (
                            <span className="text-zinc-600">未测试</span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleTest(providerId, model.id)}
                            disabled={isTesting}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                          >
                            测试
                          </button>

                          {isActive ? (
                            <span className="px-2 py-1 rounded bg-emerald-900/60 text-emerald-300 text-[11px] font-medium flex items-center gap-1">
                              <Check className="w-3 h-3 stroke-[2.5]" />
                              <span>已激活</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveMutation.mutate({
                                  provider: providerId,
                                  model: model.id,
                                })
                              }
                              className="px-2 py-1 rounded border border-zinc-700 hover:border-emerald-600 hover:text-emerald-400 text-zinc-300 text-[11px] transition-colors cursor-pointer"
                            >
                              设为默认
                            </button>
                          )}

                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  confirm(
                                    `确定要从提供商 ${providerId} 中删除模型 "${model.name || model.id}" 吗？`
                                  )
                                ) {
                                  deleteModelMutation.mutate({
                                    providerId,
                                    modelId: model.id,
                                  });
                                }
                              }}
                              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                              title="删除此模型"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
