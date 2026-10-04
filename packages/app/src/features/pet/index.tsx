import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from '@tauri-apps/api/window';
import { Bell, SquarePen, AudioLines } from 'lucide-react';
import { isTauriEnvironment } from '../../utils/window.js';
import { usePetPreferences } from '../../shared/preferences/pet.js';
import { useRuntime } from '../../context/RuntimeContext.js';
import { trpc } from '../../utils/trpc.js';
import { RoverWebSocketClient, type ConnectionStatus } from '../../utils/websocket.js';
import { PromptInput } from './editor/PromptInput.js';
import type { SuggestionItemData, PromptDocumentV1 } from './editor/types.js';
import { PetAvatar, type PetState } from './components/PetAvatar.js';
import { PetBubble } from './PetBubble/index.js';
import { TaskCard, type TaskItem } from './components/TaskCard.js';
import { PendingQueue, type PendingPromptItem } from './components/PendingQueue.js';

const DEFAULT_AGENTS: SuggestionItemData[] = [
  { id: 'claude-code', kind: 'agent', label: 'Claude Code', description: 'Anthropic Coding CLI' },
  { id: 'codex', kind: 'agent', label: 'Codex', description: 'OpenAI Code Generator' },
];

const DEFAULT_SKILLS: SuggestionItemData[] = [
  {
    id: 'agent-dispatch',
    kind: 'skill',
    label: 'agent-dispatch',
    description: '智能派发任务给 Coding Agent',
  },
  {
    id: 'task-recall',
    kind: 'skill',
    label: 'task-recall',
    description: '查询和回忆历史任务上下文',
  },
];

function extractPromptText(doc: PromptDocumentV1): string {
  const prefixes = { agent: '@', skill: '/', inbox: '#' };
  return doc.parts
    .map((part) =>
      part.type === 'text'
        ? part.text
        : part.label.startsWith(prefixes[part.kind])
          ? part.label
          : `${prefixes[part.kind]}${part.label}`
    )
    .join('')
    .trim();
}

export function PetWindow() {
  const { connection, loading, error } = useRuntime();
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('connecting');
  const [isExpanded, setIsExpanded] = useState(false);
  const [focusComposer, setFocusComposer] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const isNative = isTauriEnvironment();
  const { size: petSize } = usePetPreferences();
  const scale = petSize / 100;

  // Turn state
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [bubbleTaskId, setBubbleTaskId] = useState<string | null>(null);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isErrorStatus, setIsErrorStatus] = useState(false);
  const finishedTurnIdsRef = useRef<Set<string>>(new Set());

  // Tasks state
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);

  // Pending Prompt Queue
  const [pendingQueue, setPendingQueue] = useState<PendingPromptItem[]>([]);
  const [queueDeferred, setQueueDeferred] = useState(false);

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
              '--pet-main-max-height',
              `${Math.max(60, Math.min(610, availableHeight / scale - 184))}px`
            );
          }
          const height = Math.ceil(shell.getBoundingClientRect().height + 78 * scale);
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
    resize();
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [isNative, scale]);

  const healthQuery = trpc.health.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
  });
  const activeModelQuery = trpc.models.getActive.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 3000,
    staleTime: 0,
  });
  const tasksQuery = trpc.tasks.list.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 5000,
  });
  const openTerminalMutation = trpc.tasks.openTerminal.useMutation();
  const hasActiveModel = Boolean(activeModelQuery.data?.hasActiveModel);

  useEffect(() => {
    if (tasksQuery.data) setTasks(tasksQuery.data as TaskItem[]);
  }, [tasksQuery.data]);

  const startTurnMutation = trpc.turns.start.useMutation({
    onSuccess: (data) => {
      if (finishedTurnIdsRef.current.has(data.turnId)) return;
      setBubbleTaskId(null);
      setActiveTurnId(data.turnId);
      setIsErrorStatus(false);
      setIsThinking(true);
      setBubbleText('Rover 启动中...');
    },
    onError: (err) => {
      setActiveTurnId(null);
      setIsThinking(false);
      setIsErrorStatus(true);
      const msg = err.message.includes('No active model')
        ? '未配置激活模型，请前往控制面板配置'
        : err.message;
      setBubbleText(`启动失败: ${msg}`);
    },
  });

  useEffect(() => {
    if (!connection) return;
    const client = new RoverWebSocketClient({
      url: connection.ws_url,
      token: connection.token,
      onStatusChange: (status) => setWsStatus(status),
      onEvent: (event: any) => {
        if (event.type === 'turn.started') {
          setBubbleTaskId(null);
          setActiveTurnId(event.payload?.turnId ?? null);
          setIsThinking(true);
          setIsErrorStatus(false);
          setBubbleText('思考中...');
        } else if (event.type === 'turn.delta') {
          setIsErrorStatus(false);
          const {
            textDelta,
            accumulated,
            thinkingDelta,
            isThinking: deltaThinking,
          } = event.payload || {};
          if (deltaThinking) {
            setIsThinking(true);
            setBubbleText(accumulated || thinkingDelta || '深度思考中...');
          } else {
            setIsThinking(false);
            if (accumulated !== undefined && accumulated !== '') setBubbleText(accumulated);
            else if (textDelta) {
              setBubbleText((prev) => {
                if (
                  !prev ||
                  prev === '思考中...' ||
                  prev === '深度思考中...' ||
                  prev === 'Rover 启动中...'
                )
                  return textDelta;
                return prev + textDelta;
              });
            }
          }
        } else if (event.type === 'turn.end') {
          const { turnId, status, error: turnError } = event.payload || {};
          if (turnId) finishedTurnIdsRef.current.add(turnId);
          setActiveTurnId((prev) => (prev === turnId || !turnId ? null : prev));
          setIsThinking(false);
          if (status === 'failed' || turnError) {
            setIsErrorStatus(true);
            const displayError = turnError?.includes('No active model')
              ? '未配置激活模型，请前往配置'
              : turnError || '执行失败';
            setBubbleText(`回合失败: ${displayError}`);
          } else {
            setIsErrorStatus(false);
            setBubbleText((prev) =>
              prev === '思考中...' || prev === '深度思考中...' || prev === 'Rover 启动中...'
                ? '回复完成'
                : prev
            );
          }
        }

        if (event.type === 'task.changed') {
          const payload = event.payload;
          setTasks((prev) => {
            const idx = prev.findIndex((task) => task.id === payload.taskId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                status: payload.status,
                progressText:
                  payload.progressText !== undefined
                    ? payload.progressText
                    : next[idx].progressText,
                resultText:
                  payload.resultText !== undefined ? payload.resultText : next[idx].resultText,
                updatedAt: payload.updatedAt || Date.now(),
              };
              return next;
            }
            const newTask: TaskItem = {
              id: payload.taskId,
              goal: payload.goal || '任务进行中',
              agent: payload.agent || 'claude',
              status: payload.status,
              progressText: payload.progressText,
              resultText: payload.resultText,
              createdAt: payload.createdAt || Date.now(),
              updatedAt: payload.updatedAt || Date.now(),
            };
            return [newTask, ...prev];
          });
          if (payload.status === 'needs_intervention') {
            setBubbleTaskId(payload.taskId);
            setBubbleText('任务需要你确认，请返回原 Agent 会话处理。');
          }
        }
      },
    });
    client.connect();
    return () => client.disconnect();
  }, [connection]);

  const handleOpenDashboard = async () => {
    try {
      await invoke('show_window', { label: 'dashboard' });
    } catch (e) {
      console.error('Failed to open dashboard window:', e);
    }
  };

  const handleOpenTerminal = async (taskId: string) => {
    setOpeningTaskId(taskId);
    try {
      const res = await openTerminalMutation.mutateAsync({ taskId });
      if (!res.success) {
        setIsErrorStatus(true);
        setBubbleText(res.error || '唤起终端失败');
      } else {
        setIsErrorStatus(false);
        setBubbleText(
          `已在终端中接入会话 (${res.actionType === 'attach' ? '实时附着' : '恢复会话'})`
        );
      }
    } catch (err: any) {
      setIsErrorStatus(true);
      setBubbleText(`接管失败: ${err?.message || '通信异常'}`);
    } finally {
      setOpeningTaskId(null);
    }
  };

  const isOnline = !loading && !error && healthQuery.isSuccess && wsStatus === 'connected';

  const handleSubmitPrompt = (doc: PromptDocumentV1) => {
    if (!isOnline || !hasActiveModel) {
      setIsErrorStatus(true);
      setBubbleText(
        !isOnline
          ? 'Runtime 连接离线，请稍后重试。'
          : '无法发送：未配置激活模型，请前往 Dashboard 配置。'
      );
      return false;
    }
    if (activeTurnId || startTurnMutation.isPending || pendingQueue.length > 0) {
      setQueueDeferred(false);
      setPendingQueue((prev) => [
        ...prev,
        {
          id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          doc,
          textSnippet: extractPromptText(doc),
          createdAt: Date.now(),
        },
      ]);
      setBubbleText('已加入待处理 Prompt，确认后继续下一条。');
      return true;
    }
    startTurnMutation.mutate({ promptDoc: doc });
    return true;
  };

  const handleProceedNextPending = () => {
    if (
      !pendingQueue.length ||
      activeTurnId ||
      startTurnMutation.isPending ||
      !isOnline ||
      !hasActiveModel
    )
      return;
    const nextItem = pendingQueue[0];
    setQueueDeferred(false);
    setPendingQueue((prev) => prev.slice(1));
    startTurnMutation.mutate({ promptDoc: nextItem.doc });
  };

  const hasInterventionTask = tasks.some((task) => task.status === 'needs_intervention');
  const attentionCount = tasks.filter(
    (task) =>
      task.status === 'needs_intervention' ||
      task.status === 'failed' ||
      task.status === 'unverified'
  ).length;
  const bubbleTask = tasks.find((task) => task.id === bubbleTaskId);
  const sortedTasks = [...tasks].sort((a, b) => {
    const priority = (task: TaskItem) =>
      task.status === 'needs_intervention' ? 0 : task.status === 'running' ? 1 : 2;
    return priority(a) - priority(b) || b.updatedAt - a.updatedAt;
  });
  const petState: PetState = !isOnline
    ? 'idle'
    : hasInterventionTask
      ? 'alert'
      : isThinking
        ? 'thinking'
        : activeTurnId
          ? 'talking'
          : isErrorStatus
            ? 'error'
            : 'idle';

  return (
    <div
      className={`pet-window box-border flex h-full w-full items-start justify-end pt-[calc(58px*var(--pet-scale))] px-[calc(18px*var(--pet-scale))] pb-[calc(20px*var(--pet-scale))] font-sans leading-[normal] text-[#263246] [&_button]:cursor-pointer [&_button:disabled]:cursor-default [&_button:focus-visible]:outline-3 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#8bb8ff]${isNative ? ' pet-window--native' : ''}`}
      style={{ '--pet-scale': scale } as CSSProperties}
    >
      <div
        className="pet-shell ml-[100px] w-[420px] shrink-0"
        style={{ zoom: scale }}
        ref={shellRef}
      >
        <div className="pet-area relative flex h-[106px] items-center justify-center">
          <PetAvatar
            isOnline={isOnline}
            state={petState}
            isExpanded={isExpanded}
            onToggleExpand={() => {
              setFocusComposer(false);
              setIsExpanded((value) => !value);
            }}
            attentionCount={attentionCount}
          />
          <PetBubble
            text={bubbleText}
            isThinking={isThinking}
            isError={isErrorStatus}
            statusLabel={bubbleTask?.status === 'needs_intervention' ? '需要你确认' : undefined}
            onClose={() => setBubbleText(null)}
            onOpenSession={
              bubbleTask && bubbleTask.sessionRef?.availability !== 'unavailable'
                ? () => {
                    void handleOpenTerminal(bubbleTask.id);
                  }
                : undefined
            }
            sessionLabel={bubbleTask?.status === 'needs_intervention' ? '去确认' : '打开原会话'}
          />
        </div>
        <div
          className={`pet-main overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#ffffff80_transparent] ${isNative ? 'max-h-[var(--pet-main-max-height,610px)]' : 'max-h-[min(610px,calc(100vh/var(--pet-scale)_-_184px))]'}`}
        >
          {!isExpanded ? (
            <div
              className="compact-controls mx-auto mt-[9px] flex h-[58px] w-[201px] items-center justify-center rounded-full bg-white shadow-[0_7px_20px_#172a4140] [&>button]:relative [&>button]:grid [&>button]:h-[39px] [&>button]:w-[64px] [&>button]:place-items-center [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-[#252c34] [&>button:hover]:text-[#3479ed] [&>button+button]:border-l [&>button+button]:border-[#e6e8ec] [&_svg]:size-[22px] [&_svg]:stroke-2"
              aria-label="快捷操作胶囊"
            >
              <button
                type="button"
                onClick={() => {
                  setFocusComposer(true);
                  setIsExpanded(true);
                }}
                aria-label="问 Rover 或交办任务"
              >
                <SquarePen />
              </button>
              <button
                type="button"
                aria-label="语音输入"
                onClick={() => {
                  setIsErrorStatus(false);
                  setBubbleTaskId(null);
                  setBubbleText('语音输入暂未接入，可以点击左侧按钮用文字告诉 Rover。');
                }}
              >
                <AudioLines />
              </button>
              <button
                type="button"
                onClick={() => {
                  setFocusComposer(false);
                  setIsExpanded(true);
                }}
                aria-label="展开任务列表，查看需关注任务"
              >
                <Bell />
                {attentionCount > 0 && (
                  <em className="absolute -top-px right-[10px] grid h-[21px] min-w-[21px] place-items-center rounded-full border-2 border-white bg-[#37c56b] text-[11px] font-extrabold text-white not-italic">
                    {attentionCount}
                  </em>
                )}
              </button>
            </div>
          ) : (
            <>
              <PromptInput
                autoFocus={focusComposer}
                placeholder="问 Rover，或交给它一件事"
                availableAgents={DEFAULT_AGENTS}
                availableSkills={DEFAULT_SKILLS}
                onSubmit={handleSubmitPrompt}
              />
              {!isOnline ? (
                <div
                  className="pet-connection-notice mt-[10px] flex items-center justify-between gap-2 rounded-[19px] bg-[#fffffff4] px-[14px] py-[10px] text-[11px] text-[#657993] [&>button]:rounded-full [&>button]:border-0 [&>button]:bg-[#edf3ff] [&>button]:px-[9px] [&>button]:py-[6px] [&>button]:text-[10px] [&>button]:whitespace-nowrap [&>button]:text-[#3266ba]"
                  role="status"
                >
                  {loading ? '正在连接 Runtime…' : 'Runtime 连接离线，请稍后重试。'}
                </div>
              ) : !hasActiveModel ? (
                <div
                  className="pet-connection-notice mt-[10px] flex items-center justify-between gap-2 rounded-[19px] bg-[#fffffff4] px-[14px] py-[10px] text-[11px] text-[#657993] [&>button]:rounded-full [&>button]:border-0 [&>button]:bg-[#edf3ff] [&>button]:px-[9px] [&>button]:py-[6px] [&>button]:text-[10px] [&>button]:whitespace-nowrap [&>button]:text-[#3266ba]"
                  role="status"
                >
                  <span>尚未配置 Rover 使用的模型</span>
                  <button type="button" onClick={handleOpenDashboard}>
                    去配置
                  </button>
                </div>
              ) : null}
              {(activeTurnId || startTurnMutation.isPending) && (
                <div
                  className="pending-question mx-[11px] mt-[6px] text-[10px] font-bold text-[#f4f8ff] [text-shadow:0_1px_5px_#20395470]"
                  role="status"
                >
                  Rover 正在处理当前输入；可以继续提交，后续 Prompt 会先存入界面队列。
                </div>
              )}
              <PendingQueue
                queue={pendingQueue}
                onRemove={(id) => setPendingQueue((prev) => prev.filter((item) => item.id !== id))}
                onConfirmNext={handleProceedNextPending}
                onDefer={() => setQueueDeferred(true)}
                isDeferred={queueDeferred}
                canProceed={
                  isOnline &&
                  hasActiveModel &&
                  !activeTurnId &&
                  !startTurnMutation.isPending &&
                  pendingQueue.length > 0
                }
              />
              <div className="task-list-label mx-[5px] mt-[14px] flex items-center justify-between text-[11px] font-extrabold tracking-[0.3px] text-[#f6f9ff] [text-shadow:0_1px_5px_#20395470] [&>span]:min-w-[19px] [&>span]:rounded-full [&>span]:bg-[#ffffffbf] [&>span]:px-[6px] [&>span]:py-[2px] [&>span]:text-center [&>span]:text-[#446080] [&>span]:[text-shadow:none]">
                任务列表 <span>{tasks.length}</span>
              </div>
              <div className="task-list mt-2 grid gap-[10px]" aria-label="任务列表">
                {sortedTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onOpenTerminal={handleOpenTerminal}
                    isOpening={openingTaskId === task.id}
                  />
                ))}
                {tasks.length === 0 && (
                  <div className="pet-empty rounded-[27px] border border-[#ffffffee] bg-[#fffffff4] px-5 py-[19px] text-[11px] text-[#686f7c] shadow-[0_7px_20px_#1f344b17]">
                    目前没有任务
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
