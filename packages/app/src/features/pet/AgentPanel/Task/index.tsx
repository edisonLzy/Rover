import { useRuntime } from '../../../../context/RuntimeContext.js';
import { trpc } from '../../../../utils/trpc.js';
import { TaskList } from './TaskList.js';

export function useTaskActivity() {
  const { connection } = useRuntime();
  const options = { enabled: !!connection, refetchInterval: 5000 };
  // A running task can be outside the most recent page shown in the panel.
  const running = trpc.tasks.list.useQuery({ status: 'running', limit: 1 }, options);
  const attention = trpc.tasks.list.useQuery({ status: 'needs_intervention', limit: 1 }, options);
  return { running: !!running.data?.length, attention: !!attention.data?.length };
}

export function Task({ search }: { search: string }) {
  const { connection } = useRuntime();
  const tasks = trpc.tasks.list.useQuery(
    { limit: 100 },
    {
      enabled: !!connection,
      refetchInterval: 5000,
    }
  );
  return (
    <div className="panel-section">
      <div className="panel-section-heading">
        <h1>Tasks</h1>
        <p>你的 Agent，正在并行工作。</p>
      </div>
      <TaskList
        tasks={tasks.data ?? []}
        loading={tasks.isPending && !!connection}
        error={tasks.error?.message}
        search={search}
      />
    </div>
  );
}
