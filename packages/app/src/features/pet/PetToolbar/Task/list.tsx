import { useState } from 'react';
import { trpc } from '../../../../utils/trpc.js';
import { TaskCard, type TaskItem } from '../../components/TaskCard.js';

interface TaskListProps {
  tasks: TaskItem[];
  loading: boolean;
  error?: string;
}

export function TaskList({ tasks, loading, error }: TaskListProps) {
  const openTerminal = trpc.tasks.openTerminal.useMutation();
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleOpenTerminal = async (taskId: string) => {
    if (openingTaskId) return;
    setOpeningTaskId(taskId);
    setOpenError(null);
    try {
      const result = await openTerminal.mutateAsync({ taskId });
      if (!result.success) setOpenError(result.error || '唤起终端失败');
    } catch (failure: unknown) {
      setOpenError(failure instanceof Error ? failure.message : '唤起终端失败');
    } finally {
      setOpeningTaskId(null);
    }
  };

  const sortedTasks = [...tasks].sort((a, b) => {
    const priority = { needs_intervention: 0, running: 1, failed: 2, completed: 2, unverified: 2 };
    return priority[a.status] - priority[b.status] || b.updatedAt - a.updatedAt;
  });

  return (
    <section
      id="pet-task-list"
      aria-label="任务列表"
      className="pet-feature-list col-span-5 grid gap-[10px]"
    >
      {(error || openError) && (
        <p role="alert" className="rounded-[19px] bg-white/95 px-4 py-3 text-xs text-[#a45535]">
          {openError || error}
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
      {!tasks.length && (
        <p className="rounded-[27px] bg-white/95 px-5 py-5 text-xs text-[#657993]">
          {loading ? '正在读取任务…' : '目前没有任务'}
        </p>
      )}
    </section>
  );
}
