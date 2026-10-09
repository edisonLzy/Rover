import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../utils/window.js';
import { usePetPreferences } from '../../shared/preferences/pet.js';
import { useRuntime, type ConnectionStatus } from '../../context/RuntimeContext.js';
import { trpc } from '../../utils/trpc.js';
import { Pet } from './Pet/index.js';
import { PetBubble } from './PetBubble/index.js';
import { PetToolbar } from './PetToolbar/index.js';
import { useFollowUps } from './useFollowUps.js';
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
        className="pet-shell relative ml-[100px] w-[420px] shrink-0"
        style={{ zoom: scale }}
      >
        <div className="pet-area relative grid min-h-[106px] grid-cols-[155px_110px_155px] items-center">
          <div className="col-start-2 row-start-1 flex justify-center">
            <Pet onHoverChange={setPetHovered} />
          </div>
          <PetBubble scale={scale} followUps={runtime.followUps} isBusy={runtime.isBusy} />
        </div>
        <PetToolbar
          petHovered={petHovered}
          isBusy={runtime.isBusy}
          submissionUnavailable={runtime.submissionUnavailable}
          onSubmit={runtime.submitPrompt}
          onFollowUp={runtime.followUps.enqueue}
          hasFollowUps={runtime.followUps.items.length > 0}
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
          // CSS offsets are unscaled in every WebView; apply the pet zoom exactly once.
          let height = Math.ceil((shell.offsetHeight + 78) * scale);
          document.querySelectorAll<HTMLElement>('.pet-suggestions').forEach((popup) => {
            let top = popup.offsetTop;
            let parent = popup.offsetParent as HTMLElement | null;
            while (parent && parent !== shell) {
              top += parent.offsetTop;
              parent = parent.offsetParent as HTMLElement | null;
            }
            height = Math.max(height, Math.ceil((58 + top + popup.offsetHeight + 12) * scale));
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

// 输入生命周期管理；输出订阅与气泡生命周期已完整收敛至 PetBubble (015)。
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
    submitPrompt,
    followUps,
    submissionUnavailable,
    isBusy: !!activeTurnId || startTurn.isPending,
  };
}
