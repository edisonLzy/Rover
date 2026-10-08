import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@rover/runtime/expose';

export const trpc = createTRPCReact<AppRouter>();
export type { AppRouter };
