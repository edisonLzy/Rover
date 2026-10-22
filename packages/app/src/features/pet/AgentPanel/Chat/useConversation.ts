import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../../../../context/RuntimeContext.js';
import { trpc } from '../../../../utils/trpc.js';
import {
  parseApprovalPayload,
  summarizeToolCall,
  toChatMessage,
  type ChatMessage,
  type HistoryEntry,
  type ProcessingState,
} from './types.js';

type Approval = Extract<ProcessingState, { status: 'approval' }> & {
  turnId?: string;
  receivedAt?: number;
};
const PAGE_SIZE = 50;

// This owner remains mounted while the panel is collapsed or another tab is selected.
export function useConversation(activeTurnId: string | null) {
  const { connection, wsClient } = useRuntime();
  const utils = trpc.useUtils();
  const feed = trpc.history.getFeed.useQuery(
    { limit: PAGE_SIZE, order: 'desc', type: 'message' },
    { enabled: !!connection, refetchInterval: 5000 }
  );
  const pending = trpc.permissions.getPendingRequests.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
  });
  const resolve = trpc.permissions.resolve.useMutation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [processing, setProcessing] = useState<ProcessingState>({ status: 'idle' });
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [resolving, setResolving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const active = useRef<string | null>(null);
  const finished = useRef(new Set<string>());
  const handled = useRef(new Set<string>());
  const segment = useRef(0);
  const answer = useRef('');
  const resolvingRef = useRef(false);
  const loadingRef = useRef(false);
  const current = useRef({ feed, pending });
  current.current = { feed, pending };

  // The window also restores turn status from persistence after missed WebSocket events.
  useEffect(() => {
    if (activeTurnId && active.current !== activeTurnId && !finished.current.has(activeTurnId)) {
      active.current = activeTurnId;
      answer.current = '';
      segment.current = 0;
      setProcessing({ status: 'thinking' });
    } else if (!activeTurnId && active.current) {
      finished.current.add(active.current);
      active.current = null;
      setProcessing({ status: 'idle' });
    }
  }, [activeTurnId]);

  const mergeEntries = (next: HistoryEntry[]) => {
    setEntries((previous) => {
      const byId = new Map(previous.map((entry) => [entry.id, entry]));
      next.forEach((entry) => byId.set(entry.id, entry));
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
  };

  useEffect(() => {
    if (!feed.data) return;
    mergeEntries(feed.data);
    // Only the first page determines initial availability. Loading older pages owns it afterward.
    setHasOlder((previous) => (entries.length ? previous : feed.data.length === PAGE_SIZE));
  }, [feed.data]);

  useEffect(() => {
    if (!pending.data) return;
    setApprovals((previous) => {
      const byId = new Map(previous.map((request) => [request.requestId, request]));
      pending.data.forEach((request) => {
        if (!handled.current.has(request.requestId)) {
          byId.set(request.requestId, {
            ...byId.get(request.requestId),
            status: 'approval',
            requestId: request.requestId,
            ...parseApprovalPayload(request.payload),
          });
        }
      });
      const activeIds = new Set(pending.data.map((request) => request.requestId));
      return [...byId.values()].filter(
        (request) =>
          (request.receivedAt ?? 0) > (pending.dataUpdatedAt ?? 0) ||
          activeIds.has(request.requestId)
      );
    });
  }, [pending.data, pending.dataUpdatedAt]);

  useEffect(() => {
    const refresh = () => {
      void current.current.feed.refetch();
    };
    const updateAnswer = (turnId: string, text: string, isError = false) => {
      const id = `live:${turnId}:${segment.current}`;
      setLive((previous) => {
        const existing = previous.find((message) => message.id === id);
        const message: ChatMessage = {
          id,
          turnId,
          role: 'assistant',
          text,
          isError,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        return [...previous.filter((entry) => entry.id !== id), message];
      });
    };
    const unregister = wsClient.registerEventHandler({
      'turn.started': ({ turnId }) => {
        if (finished.current.has(turnId)) return;
        active.current = turnId;
        answer.current = '';
        segment.current = 0;
        setProcessing({ status: 'thinking' });
        refresh();
      },
      'turn.delta': (payload) => {
        if (finished.current.has(payload.turnId)) return;
        // A reconnect can receive deltas without seeing the original turn.started.
        if (!active.current) active.current = payload.turnId;
        if (active.current !== payload.turnId) return;
        if (payload.isThinking) {
          setProcessing({ status: 'thinking' });
          return;
        }
        answer.current = payload.accumulated || answer.current + (payload.textDelta ?? '');
        if (answer.current) updateAnswer(payload.turnId, answer.current);
        setProcessing({ status: 'idle' });
      },
      'turn.tool_call': (payload) => {
        if (active.current !== payload.turnId) return;
        answer.current = '';
        segment.current += 1;
        setProcessing({
          status: 'tool_call',
          toolName: payload.toolName,
          summary: summarizeToolCall(payload.toolName, payload.args),
        });
        refresh();
      },
      'turn.tool_result': (payload) => {
        if (active.current === payload.turnId) setProcessing({ status: 'thinking' });
      },
      'permission.requested': (payload) => {
        if (
          (payload.turnId && finished.current.has(payload.turnId)) ||
          handled.current.has(payload.requestId)
        )
          return;
        setApprovals((previous) =>
          previous.some((request) => request.requestId === payload.requestId)
            ? previous
            : [
                ...previous,
                {
                  status: 'approval',
                  requestId: payload.requestId,
                  turnId: payload.turnId,
                  receivedAt: Date.now(),
                  ...parseApprovalPayload(payload.payload),
                },
              ]
        );
        setApprovalError(null);
        void current.current.pending.refetch();
      },
      'turn.end': (payload) => {
        finished.current.add(payload.turnId);
        if (finished.current.size > 100)
          finished.current.delete(finished.current.values().next().value!);
        setApprovals((previous) => previous.filter((request) => request.turnId !== payload.turnId));
        if (active.current !== payload.turnId) {
          refresh();
          return;
        }
        if (payload.status === 'failed')
          updateAnswer(payload.turnId, payload.error || '回合失败', true);
        else if (payload.status === 'cancelled')
          updateAnswer(payload.turnId, answer.current || '本轮已取消');
        active.current = null;
        setProcessing({ status: 'idle' });
        refresh();
        void current.current.pending.refetch();
      },
      'rover.entry.appended': refresh,
    });
    const unsubscribe = wsClient.subscribeState(() => {
      if (wsClient.getStatus() === 'connected') {
        refresh();
        void current.current.pending.refetch();
      }
    });
    return () => {
      unregister();
      unsubscribe();
    };
  }, [wsClient]);

  const loadOlder = async () => {
    const beforeSeq = entries[0]?.seq;
    if (!beforeSeq || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    setHistoryError(null);
    try {
      const page = await utils.history.getFeed.fetch({
        limit: PAGE_SIZE,
        order: 'desc',
        type: 'message',
        beforeSeq,
      });
      mergeEntries(page);
      setHasOlder(page.length === PAGE_SIZE);
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : '读取历史失败');
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  };

  const approval = approvals.at(0);
  const resolveApproval = async (approved: boolean) => {
    if (!approval || resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    setApprovalError(null);
    try {
      const result = await resolve.mutateAsync({
        requestId: approval.requestId,
        approved,
        ...(approved && approval.kind === 'workspace_access' ? { trustWorkspace: true } : {}),
      });
      if (!result.success) throw new Error('审批请求已失效，请刷新后重试');
      handled.current.add(approval.requestId);
      setApprovals((previous) => previous.filter((item) => item.requestId !== approval.requestId));
      setProcessing(active.current ? { status: 'thinking' } : { status: 'idle' });
      void pending.refetch();
    } catch (failure) {
      setApprovalError(failure instanceof Error ? failure.message : '审批失败，请重试');
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  };

  const saved = entries.map(toChatMessage).filter((message): message is ChatMessage => !!message);
  const unmatched = [...saved];
  const provisional = live.filter((message) => {
    const index = unmatched.findIndex(
      (entry) =>
        entry.turnId === message.turnId &&
        entry.role === message.role &&
        entry.text === message.text
    );
    if (index < 0) return true;
    unmatched.splice(index, 1);
    return false;
  });
  const messages = [...saved, ...provisional].sort((a, b) => a.createdAt - b.createdAt);
  return {
    messages,
    processing: approval ?? processing,
    hasApproval: !!approval,
    resolving,
    approvalError,
    historyError: historyError || feed.error?.message,
    loading: feed.isPending && !!connection,
    loadingOlder,
    hasOlder,
    loadOlder,
    retry: () => {
      setHistoryError(null);
      return feed.refetch();
    },
    approve: () => resolveApproval(true),
    deny: () => resolveApproval(false),
  };
}
