/**
 * Public API router contract for @rover/runtime/router
 * Exposes the tRPC AppRouter contract and Context types for frontend clients.
 */

export { appRouter } from './transport/router.js';
export type { AppRouter, Context } from './transport/router.js';
