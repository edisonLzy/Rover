/**
 * Public API exposed by @rover/runtime for consumption by @rover/app and frontend clients.
 * Exposes tRPC AppRouter contract, PromptDocumentV1 schemas, and shared domain contracts.
 */

// tRPC AppRouter & Context
export { appRouter } from './transport/router.js';
export type { AppRouter, Context } from './transport/router.js';

// Prompt Document V1 Specification & Schemas (Ticket 002)
export {
  PromptDocumentV1Schema,
  parsePromptDocument,
  safeParsePromptDocument,
  promptDocumentToPlainText,
} from './types/prompt.js';
export type {
  PromptDocumentV1,
  PromptPart,
  PromptTextPart,
  PromptReferencePart,
  PromptReferenceKind,
} from './types/prompt.js';
