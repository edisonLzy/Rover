import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePetPreferences } from '../../shared/preferences/pet.js';
import { useRuntime, type ConnectionStatus } from '../../context/RuntimeContext.js';
import { trpc } from '../../utils/trpc.js';
import { Pet } from './Pet/index.js';
import { AgentPanel } from './AgentPanel/index.js';
import { useConversation } from './AgentPanel/Chat/index.js';
import { useTaskActivity } from './AgentPanel/Task/index.js';
import { useFollowUps } from './useFollowUps.js';
import { usePetWindowLayout } from './usePetWindowLayout.js';
import type { PromptDocumentV1 } from './AgentPanel/PromptInput/types.js';

export function PetWindow() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const { size } = usePetPreferences();
  const scale = size / 100;
  const runtime = usePetRuntime();
  const conversation = useConversation(runtime.activeTurnId);
  const taskActivity = useTaskActivity();
  usePetWindowLayout(shellRef, expanded, scale);
  const activity = !runtime.isOnline
    ? 'offline'
    : conversation.hasApproval || taskActivity.attention
      ? 'attention'
      : runtime.isBusy || taskActivity.running
        ? 'running'
        : 'idle';
  const collapse = () => {
    setExpanded(false);
    shellRef.current?.querySelector<HTMLButtonElement>('.pet-avatar')?.focus();
  };
  return (
    <div
      className="pet-window"
      style={{ '--pet-scale': scale } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) collapse();
      }}
    >
      <div
        ref={shellRef}
        className={`pet-shell ${expanded ? 'is-expanded' : 'is-collapsed'}`}
        style={{ zoom: scale }}
      >
        <div className="pet-avatar-slot">
          <Pet
            expanded={expanded}
            activity={activity}
            onToggle={() => setExpanded((value) => !value)}
          />
        </div>
        <AgentPanel
          expanded={expanded}
          scale={scale}
          isBusy={runtime.isBusy}
          conversation={conversation}
          followUps={runtime.followUps}
          submissionUnavailable={runtime.submissionUnavailable}
          onSubmit={runtime.submitPrompt}
          onCollapse={collapse}
        />
      </div>
    </div>
  );
}

// Submission and queue ownership stay independent from the panel's visibility.
function usePetRuntime() {
  const { connection, loading, error, wsClient } = useRuntime();
  const queryUtils = trpc.useUtils();
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>(() => wsClient.getStatus());
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const activeTurnRef = useRef<string | null>(null);
  const finishedTurnIdsRef = useRef<Set<string>>(new Set());

  const health = trpc.health.useQuery(undefined, { enabled: !!connection, refetchInterval: 3000 });
  const model = trpc.models.getActive.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
  });

  const latestTurn = trpc.history.listTurns.useQuery(
    { limit: 1 },
    { enabled: !!connection, refetchInterval: 5000 }
  );
  useEffect(() => {
    const turn = latestTurn.data?.[0];
    if (
      turn?.status === 'running' &&
      !finishedTurnIdsRef.current.has(turn.id) &&
      (!activeTurnRef.current || activeTurnRef.current === turn.id)
    ) {
      activeTurnRef.current = turn.id;
      setActiveTurnId(turn.id);
    } else if (turn && turn.status !== 'running' && activeTurnRef.current === turn.id) {
      finishedTurnIdsRef.current.add(turn.id);
      activeTurnRef.current = null;
      setActiveTurnId(null);
    }
  }, [latestTurn.data]);

  const startTurn = trpc.turns.start.useMutation({
    onSuccess: ({ turnId }) => {
      if (finishedTurnIdsRef.current.has(turnId) || activeTurnRef.current === turnId) return;
      activeTurnRef.current = turnId;
      setActiveTurnId(turnId);
    },
  });

  useEffect(() => {
    setWsStatus(wsClient.getStatus());
    return wsClient.subscribeState(() => {
      setWsStatus(wsClient.getStatus());
    });
  }, [wsClient]);

  useEffect(() => {
    return wsClient.registerEventHandler({
      'task.changed': () => {
        void queryUtils.tasks.list.invalidate();
      },
      'inbox.changed': () => {
        void queryUtils.inbox.list.invalidate();
        void queryUtils.inbox.getUnreadCount.invalidate();
      },
      'turn.started': (payload) => {
        if (finishedTurnIdsRef.current.has(payload.turnId)) return;
        activeTurnRef.current = payload.turnId;
        setActiveTurnId(payload.turnId);
      },
      'turn.end': (payload) => {
        finishedTurnIdsRef.current.add(payload.turnId);
        if (finishedTurnIdsRef.current.size > 100) {
          const oldest = finishedTurnIdsRef.current.values().next().value;
          if (oldest) finishedTurnIdsRef.current.delete(oldest);
        }
        if (activeTurnRef.current === payload.turnId) {
          activeTurnRef.current = null;
          setActiveTurnId(null);
        }
      },
    });
  }, [wsClient, queryUtils]);

  const isOnline = !loading && !error && health.isSuccess && wsStatus === 'connected';
  const submissionUnavailable = !isOnline
    ? 'Runtime 离线，请稍后重试'
    : !model.data?.hasActiveModel
      ? '请到 Dashboard 配置激活模型'
      : null;
  const followUps = useFollowUps({
    isBusy: !!activeTurnId || startTurn.isPending,
    isOnline: isOnline && !!model.data?.hasActiveModel,
    onActiveTurn: (turnId) => {
      if (turnId && finishedTurnIdsRef.current.has(turnId)) return;
      activeTurnRef.current = turnId;
      setActiveTurnId(turnId);
    },
  });
  const submitPrompt = async (doc: PromptDocumentV1) => {
    if (submissionUnavailable) throw new Error(submissionUnavailable);
    await startTurn.mutateAsync({ promptDoc: doc });
  };

  return {
    activeTurnId,
    submitPrompt,
    isOnline,
    followUps,
    submissionUnavailable,
    isBusy: !!activeTurnId || startTurn.isPending,
  };
}
