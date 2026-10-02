import { useState } from 'react';
import { Plus } from 'lucide-react';
import { trpc } from '../../../utils/trpc.js';

interface AddModelModalProps {
  providerId: string;
}

export function AddModelModal({ providerId }: AddModelModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [contextWindow, setContextWindow] = useState('128000');
  const [maxTokens, setMaxTokens] = useState('8192');
  const [reasoning, setReasoning] = useState(false);

  const utils = trpc.useUtils();

  const resetForm = () => {
    setModelId('');
    setModelName('');
    setContextWindow('128000');
    setMaxTokens('8192');
    setReasoning(false);
  };

  const handleClose = () => {
    resetForm();
    setIsOpen(false);
  };

  const addModelMutation = trpc.models.addModel.useMutation({
    onSuccess: () => {
      utils.models.getConfig.invalidate();
      handleClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelId.trim()) return;

    addModelMutation.mutate({
      providerId,
      model: {
        id: modelId.trim(),
        name: modelName.trim() || modelId.trim(),
        contextWindow: parseInt(contextWindow, 10) || 128000,
        maxTokens: parseInt(maxTokens, 10) || 8192,
        reasoning,
        input: ['text'],
        cost: { input: 0, output: 0 },
      },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
        title={`为 ${providerId} 添加新模型`}
      >
        <Plus className="w-3.5 h-3.5 text-emerald-400" />
        <span>添加模型</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-4 text-zinc-100">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">向 {providerId} 追加模型</h3>
              </div>
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
                  模型 ID <span className="text-zinc-500">(如 gpt-4o, deepseek-reasoner)</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="deepseek-reasoner"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">显示名称</label>
                <input
                  type="text"
                  placeholder="DeepSeek R1"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">上下文窗口 (Tokens)</label>
                  <input
                    type="number"
                    value={contextWindow}
                    onChange={(e) => setContextWindow(e.target.value)}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">最大输出 (Tokens)</label>
                  <input
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-zinc-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="reasoning-checkbox"
                  checked={reasoning}
                  onChange={(e) => setReasoning(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <label
                  htmlFor="reasoning-checkbox"
                  className="text-zinc-300 text-xs cursor-pointer select-none"
                >
                  支持长思维链推理 (Reasoning / R1)
                </label>
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
                  disabled={addModelMutation.isPending}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {addModelMutation.isPending ? '添加中...' : '添加模型'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
