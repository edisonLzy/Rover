import { Bell, ChevronDown } from 'lucide-react';
import { useRuntime } from '../../../../context/RuntimeContext.js';
import { trpc } from '../../../../utils/trpc.js';
import { TaskList } from './list.js';

interface TaskProps {
  active: boolean;
  controlsVisible: boolean;
  onToggle: () => void;
}

export function Task({ active, controlsVisible, onToggle }: TaskProps) {
  const { connection } = useRuntime();
  const tasks = trpc.tasks.list.useQuery(undefined, {
    enabled: !!connection,
    refetchInterval: 5000,
  });

  return (
    <>
      <button
        type="button"
        hidden={!controlsVisible}
        aria-label="任务"
        aria-expanded={active}
        aria-controls="pet-task-list"
        onClick={onToggle}
        className="pet-toolbar-trigger col-start-4"
      >
        {active ? <ChevronDown /> : <Bell />}
        {!!tasks.data?.length && <span className="pet-toolbar-count">{tasks.data.length}</span>}
      </button>
      {active && (
        <TaskList
          tasks={tasks.data ?? []}
          loading={tasks.isPending && !!connection}
          error={tasks.error?.message}
        />
      )}
    </>
  );
}
