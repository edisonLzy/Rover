import { Fragment } from 'react';

export type TaskStatus = 'running' | 'needs_intervention' | 'completed' | 'failed' | 'unverified';

export interface TaskItem {
  id: string;
  goal: string;
  agent: string;
  status: TaskStatus;
  progressText?: string | null;
  resultText?: string | null;
  createdAt: number;
  updatedAt: number;
  sessionRef?: {
    carrierName?: string;
    availability?: 'available' | 'unavailable';
    nativeSessionId?: string;
  } | null;
}

export interface TaskCardProps {
  task: TaskItem;
  onOpenTerminal: (taskId: string) => void;
  isOpening?: boolean;
}

// The prototype's result summaries use paragraphs, lists, emphasis and inline code.
// Render these as React nodes so Agent output never becomes executable HTML.
function inlineMarkdown(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )
    );
}

function TaskResult({ text }: { text: string }) {
  return (
    <div className="task-markdown mt-[10px] select-text text-[11px] leading-normal text-[#586a7e] [overflow-wrap:anywhere] [&_p]:mb-[6px] [&_p:last-child]:mb-0 [&_ul]:mt-[6px] [&_ul]:list-disc [&_ul]:pl-[18px] [&_li]:my-[3px] [&_strong]:text-[#30435c]">
      {text
        .trim()
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((block, index) => {
          const lines = block.split('\n');
          return lines.every((line) => /^[-*] /.test(line)) ? (
            <ul key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inlineMarkdown(line.slice(2))}</li>
              ))}
            </ul>
          ) : (
            <p key={index}>
              {lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex > 0 && <br />}
                  {inlineMarkdown(line)}
                </Fragment>
              ))}
            </p>
          );
        })}
    </div>
  );
}

export function TaskCard({ task, onOpenTerminal, isOpening = false }: TaskCardProps) {
  const isFinished = task.status === 'completed' || task.status === 'failed';
  const isUnavailable = task.sessionRef?.availability === 'unavailable';
  const statusLabels: Record<TaskStatus, string> = {
    running: '处理中',
    needs_intervention: '需要你确认',
    completed: '已完成',
    failed: '未完成',
    unverified: '状态待核对',
  };
  const summary = task.progressText || statusLabels[task.status];
  const sessionButton = (
    <button
      type="button"
      className={`pet-action shrink-0 rounded-full border-0 px-[11px] py-2 text-[10px] font-extrabold whitespace-nowrap disabled:opacity-50 ${isFinished ? 'session-link mt-3 bg-[#edf3ff] text-[#3266ba] hover:bg-[#dfebff]' : task.status === 'needs_intervention' ? 'primary bg-[#3479ed] text-white hover:bg-[#2067dd]' : 'bg-[#f1f3f7] text-[#4e5868] hover:bg-[#e5ebf5]'}`}
      disabled={isOpening || isUnavailable}
      onClick={(event) => {
        event.stopPropagation();
        onOpenTerminal(task.id);
      }}
    >
      {isOpening
        ? '打开会话中…'
        : isUnavailable
          ? '会话不可用'
          : task.status === 'needs_intervention'
            ? '去确认'
            : '查看会话'}
    </button>
  );

  return (
    <article
      className={`task-summary-card cursor-pointer rounded-[27px] border-2 bg-[#fffffff4] px-5 py-[17px] transition-[transform,background] duration-[180ms] hover:-translate-y-[2px] hover:bg-white ${isFinished || task.status === 'unverified' ? 'is-finished border-[#dce7ed] shadow-[0_7px_20px_#1f344b17]' : 'is-processing border-[#87b6fc] shadow-[0_0_0_3px_#8bb9ff25,0_7px_20px_#1f344b17] motion-safe:animate-pet-task-border'}${isUnavailable ? ' is-unavailable !cursor-default' : ''}`}
      aria-label={`${task.goal} · ${statusLabels[task.status]}`}
      onClick={(event) => {
        if (!isUnavailable && !isOpening && !(event.target as HTMLElement).closest('button'))
          onOpenTerminal(task.id);
      }}
    >
      <button
        type="button"
        className="task-open block w-full border-0 bg-transparent p-0 text-left text-[15px] leading-[1.4] font-[750] text-[#292f39] [overflow-wrap:anywhere]"
        disabled={isOpening || isUnavailable}
        onClick={() => onOpenTerminal(task.id)}
        aria-label={`打开 ${task.goal} 对应的 Agent Session`}
      >
        {task.goal}
      </button>
      {isFinished ? (
        <>
          <TaskResult text={task.resultText || summary} />
          {sessionButton}
        </>
      ) : (
        <div className="task-progress-row mt-[9px] flex items-center gap-[10px]">
          <p className="task-progress m-0 min-w-0 flex-1 text-[11px] leading-[1.45] font-medium text-[#66758a] [overflow-wrap:anywhere]">
            {summary}
          </p>
          {sessionButton}
        </div>
      )}
    </article>
  );
}
