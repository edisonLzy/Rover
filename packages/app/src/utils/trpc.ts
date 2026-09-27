import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@rover/runtime/router';

export const trpc = createTRPCReact<AppRouter>();
export type { AppRouter };
