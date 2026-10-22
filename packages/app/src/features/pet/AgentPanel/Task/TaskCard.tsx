import { Fragment } from 'react';
import { Check, CircleHelp, LoaderCircle, AlertCircle, ArrowUpRight, X } from 'lucide-react';

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
    <div className="task-markdown">
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
  const Icon =
    task.status === 'completed'
      ? Check
      : task.status === 'running'
        ? LoaderCircle
        : task.status === 'needs_intervention'
          ? AlertCircle
          : task.status === 'failed'
            ? X
            : CircleHelp;
  const minutes = Math.max(0, Math.floor((Date.now() - task.updatedAt) / 60000));
  const elapsed =
    minutes < 1
      ? '刚刚'
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h`
          : `${Math.floor(minutes / 1440)}d`;
  return (
    <article
      className={`task-row task-${task.status}${isUnavailable ? ' is-unavailable' : ''}`}
      aria-label={`${task.goal} · ${statusLabels[task.status]}`}
      onClick={(event) => {
        if (!isUnavailable && !isOpening && !(event.target as HTMLElement).closest('button')) {
          onOpenTerminal(task.id);
        }
      }}
    >
      <div className="task-state-icon" aria-hidden="true">
        <Icon size={17} className={task.status === 'running' ? 'motion-safe:animate-spin' : ''} />
      </div>
      <div className="task-body">
        <div className="task-title-row">
          <button
            type="button"
            className="task-title"
            disabled={isOpening || isUnavailable}
            onClick={() => onOpenTerminal(task.id)}
            aria-label={`打开 ${task.goal} 对应的 Agent Session`}
          >
            {task.goal}
          </button>
          <time
            dateTime={new Date(task.updatedAt).toISOString()}
            title={new Date(task.updatedAt).toLocaleString()}
          >
            {elapsed}
          </time>
        </div>
        <div className="task-agent">
          {task.agent === 'claude' || task.agent === 'claude-code'
            ? 'Claude Code'
            : task.agent === 'codex'
              ? 'Codex'
              : task.agent}
        </div>
        {isFinished ? (
          <TaskResult text={task.resultText || task.progressText || statusLabels[task.status]} />
        ) : (
          <p className="task-progress">{task.progressText || statusLabels[task.status]}</p>
        )}
        <div className="task-actions">
          <span className="task-status">{statusLabels[task.status]}</span>
          <button
            type="button"
            className="task-session"
            disabled={isOpening || isUnavailable}
            onClick={() => onOpenTerminal(task.id)}
          >
            {isOpening
              ? '打开会话中…'
              : isUnavailable
                ? '会话不可用'
                : task.status === 'needs_intervention'
                  ? '去确认'
                  : '查看会话'}
            {!isUnavailable && <ArrowUpRight size={12} />}
          </button>
        </div>
      </div>
    </article>
  );
}
