import { useEffect, useRef, useState } from 'react';
import type { PromptDocumentV1 } from '@rover/runtime/expose';
import { trpc } from '../../utils/trpc.js';

export interface FollowUpItem {
  id: string;
  timestamp: number;
  promptDoc: PromptDocumentV1;
}

interface Options {
  isBusy: boolean;
  isOnline: boolean;
  onActiveTurn: (turnId: string) => void;
}

export function useFollowUps(options: Options) {
  const startTurn = trpc.turns.start.useMutation();
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const current = useRef({ options, startTurn });
  current.current = { options, startTurn };

  const enqueue = async (promptDoc: PromptDocumentV1) => {
    if (!current.current.options.isOnline) throw new Error('Runtime 离线，请稍后再发送');
    const item: FollowUpItem = { id: crypto.randomUUID(), timestamp: Date.now(), promptDoc };
    const next = [...itemsRef.current, item];
    itemsRef.current = next;
    setItems(next);
    setError(null);
  };

  const remove = (id: string) => {
    const next = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = next;
    setItems(next);
  };

  const reorder = (ids: string[]) => {
    const byId = new Map(itemsRef.current.map((item) => [item.id, item]));
    if (ids.length !== byId.size || new Set(ids).size !== byId.size) return;
    const next = ids.map((id) => byId.get(id)).filter(Boolean) as FollowUpItem[];
    if (next.length === itemsRef.current.length) {
      itemsRef.current = next;
      setItems(next);
    }
  };

  const advance = async (id: string) => {
    if (startingId || error || !current.current.options.isOnline || current.current.options.isBusy)
      return;
    const target = itemsRef.current.find((item) => item.id === id);
    if (!target) return;
    setStartingId(id);
    setError(null);
    try {
      const result = await current.current.startTurn.mutateAsync({
        promptDoc: target.promptDoc,
      });
      remove(target.id);
      current.current.options.onActiveTurn(result.turnId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '启动待办失败');
    } finally {
      setStartingId(null);
    }
  };

  const nextId = items[0]?.id;
  const canAdvance = options.isOnline && !options.isBusy && !error && !startingId;
  useEffect(() => {
    if (!canAdvance || !nextId) return;
    const timer = setTimeout(() => {
      void advance(nextId);
    }, 1500);
    return () => clearTimeout(timer);
  }, [canAdvance, nextId]);

  return {
    items,
    syncing: false,
    startingId,
    error,
    enqueue,
    highlightedId: canAdvance ? nextId : undefined,
    canAdvance,
    advance: (id: string) => {
      void advance(id);
    },
    remove,
    reorder,
  };
}
