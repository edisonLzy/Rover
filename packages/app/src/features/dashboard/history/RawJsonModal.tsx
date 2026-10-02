import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';

interface RawJsonModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: unknown;
  title?: string;
}

export function RawJsonModal({
  isOpen,
  onClose,
  data,
  title = 'Entry Raw JSON',
}: RawJsonModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy JSON:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
              JSON
            </span>
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 text-xs transition-colors cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-zinc-300 bg-zinc-950/80 rounded-b-xl select-text">
          <pre className="whitespace-pre-wrap break-all leading-relaxed">{jsonString}</pre>
        </div>
      </div>
    </div>
  );
}
