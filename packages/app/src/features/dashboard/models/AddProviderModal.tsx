import { useState } from 'react';
import { Plus } from 'lucide-react';
import { trpc } from '../../../utils/trpc.js';

export function AddProviderModal() {
  const [isOpen, setIsOpen] = useState(false);
  const utils = trpc.useUtils();

  const [formId, setFormId] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formApiType, setFormApiType] = useState<'openai-completions' | 'anthropic-messages'>(
    'openai-completions'
  );
  const [formModelId, setFormModelId] = useState('');
  const [formModelName, setFormModelName] = useState('');
  const [formContextWindow, setFormContextWindow] = useState('128000');

  const resetForm = () => {
    setFormId('');
    setFormBaseUrl('');
    setFormApiKey('');
    setFormApiType('openai-completions');
    setFormModelId('');
    setFormModelName('');
    setFormContextWindow('128000');
  };

  const handleClose = () => {
    resetForm();
    setIsOpen(false);
  };

  const saveProviderMutation = trpc.models.saveProvider.useMutation({
    onSuccess: () => {
      utils.models.getConfig.invalidate();
      handleClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formId.trim() || !formBaseUrl.trim() || !formModelId.trim()) return;

    saveProviderMutation.mutate({
      id: formId.trim().toLowerCase(),
      provider: {
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim(),
        api: formApiType,
        models: [
          {
            id: formModelId.trim(),
            name: formModelName.trim() || formModelId.trim(),
            contextWindow: parseInt(formContextWindow, 10) || 128000,
            maxTokens: 8192,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0 },
          },
        ],
      },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>添加提供商</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-4 text-zinc-100">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold">添加模型提供商 (Provider)</h3>
              <button
                type="button"
                onClick={handleClose}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">
                  提供商 ID (英文字符，如 minimax, openai)
                </label>
                <input
                  type="text"
                  required
                  placeholder="deepseek"
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Base URL</label>
                <input
                  type="text"
                  required
                  placeholder="https://api.deepseek.com/v1"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">API 协议格式</label>
                  <select
                    value={formApiType}
                    onChange={(e) =>
                      setFormApiType(e.target.value as 'openai-completions' | 'anthropic-messages')
                    }
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                  >
                    <option value="openai-completions">OpenAI Completions</option>
                    <option value="anthropic-messages">Anthropic Messages</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1">上下文长度 (Token)</label>
                  <input
                    type="number"
                    value={formContextWindow}
                    onChange={(e) => setFormContextWindow(e.target.value)}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  API Key{' '}
                  <span className="text-zinc-500">(支持明文或 ${'${ENV_VAR}'} 环境变量语法)</span>
                </label>
                <input
                  type="password"
                  placeholder="sk-... 或 ${DEEPSEEK_API_KEY}"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-zinc-800">
                <div>
                  <label className="block text-zinc-400 mb-1">初始模型 ID</label>
                  <input
                    type="text"
                    required
                    placeholder="deepseek-chat"
                    value={formModelId}
                    onChange={(e) => setFormModelId(e.target.value)}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">模型显示名称</label>
                  <input
                    type="text"
                    placeholder="DeepSeek V3"
                    value={formModelName}
                    onChange={(e) => setFormModelName(e.target.value)}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800 mt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-medium transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saveProviderMutation.isPending}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {saveProviderMutation.isPending ? '保存中...' : '保存提供商'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
