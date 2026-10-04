import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@rover/runtime/expose';
import { useRuntime } from '../../../../context/RuntimeContext.js';
import { trpc } from '../../../../utils/trpc.js';

export type TaskItem = inferRouterOutputs<AppRouter>['tasks']['list'][number];

export function useTasks() {
  const { connection } = useRuntime();
  return trpc.tasks.list.useQuery(undefined, { enabled: !!connection, refetchInterval: 5000 });
}
