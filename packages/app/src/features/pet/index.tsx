import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../utils/window.js';
import { usePetPreferences } from '../../shared/preferences/pet.js';
import { useRuntime } from '../../context/RuntimeContext.js';
import { trpc } from '../../utils/trpc.js';
import { RoverWebSocketClient, type ConnectionStatus } from '../../utils/websocket.js';
import { Pet } from './Pet/index.js';
import { PetBubble } from './PetBubble/index.js';
import { PetToolbar } from './PetToolbar/index.js';
import type { PromptDocumentV1 } from './PetToolbar/PromptInput/types.js';

export function PetWindow() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [petHovered, setPetHovered] = useState(false);
  const { size } = usePetPreferences();
  const scale = size / 100;
  usePetWindowLayout(shellRef, scale);
  const runtime = usePetRuntime();

  return (
    <div
      className="pet-window box-border flex h-full w-full items-start justify-end px-[calc(18px*var(--pet-scale))] pt-[calc(58px*var(--pet-scale))] pb-[calc(20px*var(--pet-scale))] font-sans leading-[normal] text-[#263246] [&_button]:cursor-pointer [&_button:disabled]:cursor-default [&_button:focus-visible]:outline-3 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#8bb8ff]"
      style={
        {
          '--pet-scale': scale,
          '--pet-list-max-height': 'max(60px,min(610px,calc(100vh/var(--pet-scale) - 275px)))',
        } as CSSProperties
      }
    >
      <div
        ref={shellRef}
        className="pet-shell ml-[100px] w-[420px] shrink-0"
        style={{ zoom: scale }}
      >
        <div className="pet-area relative flex h-[106px] items-center justify-center">
          <Pet onHoverChange={setPetHovered} />
          <PetBubble
            text={runtime.bubbleText}
            isThinking={runtime.isThinking}
            isError={runtime.isErrorStatus}
            onClose={runtime.closeBubble}
            onOpenSession={runtime.openBubbleSession}
            sessionLabel="去确认"
          />
        </div>
        <PetToolbar
          petHovered={petHovered}
          isBusy={runtime.isBusy}
          submissionUnavailable={runtime.submissionUnavailable}
          onSubmit={runtime.submitPrompt}
        />
      </div>
    </div>
  );
}

function usePetWindowLayout(shellRef: RefObject<HTMLDivElement | null>, scale: number) {
  const isNative = isTauriEnvironment();
  useEffect(() => {
    const shell = shellRef.current;
    if (!isNative || !shell) return;
    const petWindow = getCurrentWindow();
    let previousHeight = 0;
    let disposed = false;
    let resizePromise = Promise.resolve();
    const resize = () => {
      resizePromise = resizePromise
        .then(async () => {
          if (disposed) return;
          const [monitor, position] = await Promise.all([
            currentMonitor(),
            petWindow.outerPosition(),
          ]);
          if (disposed) return;
          if (monitor) {
            const availableHeight = monitor.workArea.size.height / monitor.scaleFactor;
            shell.style.setProperty(
              '--pet-list-max-height',
              `${Math.max(60, Math.min(610, availableHeight / scale - 275))}px`
            );
          }
          let height = Math.ceil(shell.getBoundingClientRect().height + 78 * scale);
          document.querySelectorAll<HTMLElement>('.pet-suggestions').forEach((popup) => {
            const bounds = popup.getBoundingClientRect();
            height = Math.max(height, Math.ceil(bounds.bottom + 12 * scale));
            const container = popup.parentElement;
            if (container)
              container.style.left = `${Math.max(8, Math.min(bounds.left, Math.ceil(556 * scale) - bounds.width - 8))}px`;
          });
          if (monitor)
            height = Math.min(
              height,
              Math.floor(monitor.workArea.size.height / monitor.scaleFactor)
            );
          if (height === previousHeight) return;
          previousHeight = height;
          await petWindow.setSize(new LogicalSize(Math.ceil(556 * scale), height));
          if (monitor && !disposed) {
            const area = monitor.workArea;
            const x = Math.max(
              area.position.x,
              Math.min(
                position.x,
                area.position.x + area.size.width - Math.ceil(556 * scale) * monitor.scaleFactor
              )
            );
            const y = Math.max(
              area.position.y,
              Math.min(
                position.y,
                area.position.y + area.size.height - height * monitor.scaleFactor
              )
            );
            if (x !== position.x || y !== position.y)
              await petWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
          }
        })
        .catch(console.error);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    const popupObserver = new MutationObserver((mutations) => {
      if (
        !mutations.some((mutation) =>
          [...mutation.addedNodes, ...mutation.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('.pet-suggestions') || node.querySelector('.pet-suggestions'))
          )
        )
      )
        return;
      document.querySelectorAll('.pet-suggestions').forEach((popup) => observer.observe(popup));
      resize();
    });
    popupObserver.observe(document.body, { childList: true, subtree: true });
    resize();
    return () => {
      disposed = true;
      observer.disconnect();
      popupObserver.disconnect();
    };
  }, [isNative, scale]);
}

// 输入和已有气泡共享一个回合生命周期；输出订阅的归属由 015 收敛。
function usePetRuntime() {
  const { connection, loading, error } = useRuntime();
  const queryUtils = trpc.useUtils();
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('connecting');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const activeTurnRef = useRef<string | null>(null);
  const finishedTurnIdsRef = useRef(new Set<string>());
  const answerRef = useRef('');
  const thinkingRef = useRef(false);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [bubbleTaskId, setBubbleTaskId] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isErrorStatus, setIsErrorStatus] = useState(false);

  const health = trpc.health.useQuery(undefined, { enabled: !!connection, refetchInterval: 3000 });
  const model = trpc.models.getActive.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
  });
  const bubbleTasks = trpc.tasks.list.useQuery(undefined, {
    enabled: !!connection && !!bubbleTaskId,
  });
  const terminal = trpc.tasks.openTerminal.useMutation();
  const startTurn = trpc.turns.start.useMutation({
    onSuccess: ({ turnId }) => {
      // WS 可在 HTTP 回执之前开始甚至结束；回执不能重置已呈现的回复。
      if (finishedTurnIdsRef.current.has(turnId) || activeTurnRef.current === turnId) return;
      activeTurnRef.current = turnId;
      setActiveTurnId(turnId);
      answerRef.current = '';
      setBubbleTaskId(null);
      setBubbleText('Rover 启动中…');
      setIsThinking(true);
      setIsErrorStatus(false);
    },
  });

  useEffect(() => {
    if (!connection) return;
    const client = new RoverWebSocketClient({
      url: connection.ws_url,
      token: connection.token,
      onStatusChange: setWsStatus,
      onEvent: (event: unknown) => {
        if (!event || typeof event !== 'object') return;
        const envelope = event as { type?: unknown; payload?: unknown };
        if (!envelope.payload || typeof envelope.payload !== 'object') return;
        const payload = envelope.payload as Record<string, unknown>;
        const turnId = typeof payload.turnId === 'string' ? payload.turnId : null;

        if (envelope.type === 'task.changed') {
          void queryUtils.tasks.list.invalidate();
          if (payload.status === 'needs_intervention' && typeof payload.taskId === 'string') {
            setBubbleTaskId(payload.taskId);
            setBubbleText('任务需要你确认，请返回原 Agent 会话处理。');
          }
          return;
        }
        if (!turnId) return;
        if (envelope.type === 'turn.started') {
          if (finishedTurnIdsRef.current.has(turnId)) return;
          activeTurnRef.current = turnId;
          answerRef.current = '';
          setActiveTurnId(turnId);
          setBubbleTaskId(null);
          setBubbleText('思考中…');
          setIsThinking(true);
          setIsErrorStatus(false);
        } else if (envelope.type === 'turn.delta' && activeTurnRef.current === turnId) {
          const thinking = payload.isThinking === true;
          if (thinkingRef.current !== thinking) answerRef.current = '';
          thinkingRef.current = thinking;
          if (typeof payload.accumulated === 'string' && payload.accumulated) {
            answerRef.current = payload.accumulated;
          } else {
            const delta = thinking ? payload.thinkingDelta : payload.textDelta;
            if (typeof delta === 'string') answerRef.current += delta;
          }
          setBubbleTaskId(null);
          setIsThinking(thinking);
          setIsErrorStatus(false);
          setBubbleText(answerRef.current || (thinking ? '深度思考中…' : ''));
        } else if (envelope.type === 'turn.end') {
          finishedTurnIdsRef.current.add(turnId);
          if (finishedTurnIdsRef.current.size > 100) {
            const oldest = finishedTurnIdsRef.current.values().next().value;
            if (oldest) finishedTurnIdsRef.current.delete(oldest);
          }
          if (activeTurnRef.current !== turnId) return;
          activeTurnRef.current = null;
          setActiveTurnId(null);
          setIsThinking(false);
          const failed = payload.status === 'failed' || typeof payload.error === 'string';
          setIsErrorStatus(failed);
          if (failed) {
            setBubbleTaskId(null);
            setBubbleText(typeof payload.error === 'string' ? payload.error : '回合失败');
          } else if (!answerRef.current) {
            setBubbleText('回复完成');
          }
        }
      },
    });
    client.connect();
    return () => client.disconnect();
  }, [connection, queryUtils]);

  const isOnline = !loading && !error && health.isSuccess && wsStatus === 'connected';
  const submissionUnavailable = !isOnline
    ? 'Runtime 离线，请稍后重试'
    : !model.data?.hasActiveModel
      ? '请到 Dashboard 配置激活模型'
      : null;
  const submitPrompt = async (doc: PromptDocumentV1) => {
    if (submissionUnavailable) throw new Error(submissionUnavailable);
    await startTurn.mutateAsync({ promptDoc: doc });
  };
  const bubbleTask = bubbleTasks.data?.find((task) => task.id === bubbleTaskId);
  const openBubbleSession =
    bubbleTask && bubbleTask.sessionRef?.availability !== 'unavailable'
      ? async () => {
          try {
            const result = await terminal.mutateAsync({ taskId: bubbleTask.id });
            if (!result.success) {
              setIsErrorStatus(true);
              setBubbleText(result.error || '唤起终端失败');
            } else if (result.notice) {
              setIsErrorStatus(false);
              setBubbleText(result.notice);
            }
          } catch (failure: unknown) {
            setIsErrorStatus(true);
            setBubbleText(failure instanceof Error ? failure.message : '唤起终端失败');
          }
        }
      : undefined;

  return {
    bubbleText,
    isThinking,
    isErrorStatus,
    openBubbleSession,
    closeBubble: () => setBubbleText(null),
    submitPrompt,
    submissionUnavailable,
    isBusy: !!activeTurnId || startTurn.isPending,
  };
}
