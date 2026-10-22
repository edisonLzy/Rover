import { useState } from 'react';
import { trpc } from '../../../../utils/trpc.js';
import { TaskCard, type TaskItem } from './TaskCard.js';

interface TaskListProps {
  tasks: TaskItem[];
  loading: boolean;
  error?: string;
  search?: string;
}

export function TaskList({ tasks, loading, error, search = '' }: TaskListProps) {
  const openTerminal = trpc.tasks.openTerminal.useMutation();
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleOpenTerminal = async (taskId: string) => {
    if (openingTaskId) return;
    setOpeningTaskId(taskId);
    setOpenError(null);
    setOpenNotice(null);
    try {
      const result = await openTerminal.mutateAsync({ taskId });
      if (!result.success) setOpenError(result.error || '唤起终端失败');
      else setOpenNotice(result.notice || null);
    } catch (failure: unknown) {
      setOpenError(failure instanceof Error ? failure.message : '唤起终端失败');
    } finally {
      setOpeningTaskId(null);
    }
  };

  const sortedTasks = tasks
    .filter((task) =>
      [task.goal, task.agent, task.progressText, task.resultText]
        .join(' ')
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
    )
    .sort((a, b) => {
      const priority = {
        needs_intervention: 0,
        running: 1,
        failed: 2,
        completed: 2,
        unverified: 2,
      };
      return priority[a.status] - priority[b.status] || b.updatedAt - a.updatedAt;
    });

  return (
    <section id="pet-task-list" aria-label="任务列表" className="panel-scroll task-list">
      {(error || openError) && (
        <p role="alert" className="panel-error">
          {openError || error}
        </p>
      )}
      {openNotice && (
        <p role="status" className="panel-notice">
          {openNotice}
        </p>
      )}
      {sortedTasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onOpenTerminal={handleOpenTerminal}
          isOpening={openingTaskId === task.id}
        />
      ))}
      {!sortedTasks.length && (
        <p className="panel-empty">
          {loading ? '正在读取任务…' : search ? '没有匹配的任务' : '目前没有任务'}
        </p>
      )}
    </section>
  );
}
