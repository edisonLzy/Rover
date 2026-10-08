import { z } from 'zod';

export const SystemReadyPayloadSchema = z.object({
  version: z.string(),
  status: z.string(),
});

export const TurnStartedPayloadSchema = z.object({
  turnId: z.string(),
  createdAt: z.number().optional(),
});

export const TurnStepStartedPayloadSchema = z.object({
  turnId: z.string(),
  timestamp: z.number(),
});

export const TurnDeltaPayloadSchema = z.object({
  turnId: z.string(),
  textDelta: z.string().optional(),
  thinkingDelta: z.string().optional(),
  accumulated: z.string().optional(),
  isThinking: z.boolean().optional(),
});

export const TurnToolCallPayloadSchema = z.object({
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
});

export const TurnToolResultPayloadSchema = z.object({
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
  isError: z.boolean().optional(),
});

export const TurnEndPayloadSchema = z.object({
  turnId: z.string(),
  status: z.enum(['completed', 'failed', 'cancelled']),
  error: z.string().nullable().optional(),
  latencyMs: z.number().optional(),
});

export const TaskChangedPayloadSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  agent: z.string(),
  status: z.enum(['running', 'needs_intervention', 'completed', 'failed', 'unverified']),
  progressText: z.string().nullable().optional(),
  resultText: z.string().nullable().optional(),
  updatedAt: z.number(),
});

export const RoverEntryAppendedPayloadSchema = z
  .object({
    seq: z.number().optional(),
    id: z.string(),
    turnId: z.string().optional(),
    type: z.enum(['message', 'compaction']).optional(),
    schemaVersion: z.number().optional(),
    data: z.unknown().optional(),
    createdAt: z.number().optional(),
  })
  .passthrough();

export const RoverCompactionAppendedPayloadSchema = z
  .object({
    seq: z.number().optional(),
    id: z.string(),
  })
  .passthrough();

export const InboxChangedPayloadSchema = z
  .object({
    unreadCount: z.number().optional(),
    type: z.string().optional(),
    message: z.unknown().optional(),
    messageId: z.string().optional(),
    taskId: z.string().optional(),
  })
  .passthrough();

export const InboxProviderStatusPayloadSchema = z.object({
  providerId: z.string(),
  status: z.enum(['disabled', 'connecting', 'connected', 'disconnected', 'auth_failed', 'error']),
  error: z.string().optional(),
});

export type SystemReadyPayload = z.infer<typeof SystemReadyPayloadSchema>;
export type TurnStartedPayload = z.infer<typeof TurnStartedPayloadSchema>;
export type TurnStepStartedPayload = z.infer<typeof TurnStepStartedPayloadSchema>;
export type TurnDeltaPayload = z.infer<typeof TurnDeltaPayloadSchema>;
export type TurnToolCallPayload = z.infer<typeof TurnToolCallPayloadSchema>;
export type TurnToolResultPayload = z.infer<typeof TurnToolResultPayloadSchema>;
export type TurnEndPayload = z.infer<typeof TurnEndPayloadSchema>;
export type TaskChangedPayload = z.infer<typeof TaskChangedPayloadSchema>;
export type RoverEntryAppendedPayload = z.infer<typeof RoverEntryAppendedPayloadSchema>;
export type RoverCompactionAppendedPayload = z.infer<typeof RoverCompactionAppendedPayloadSchema>;
export type InboxChangedPayload = z.infer<typeof InboxChangedPayloadSchema>;
export type InboxProviderStatusPayload = z.infer<typeof InboxProviderStatusPayloadSchema>;

export interface RuntimeEventMap {
  'system.ready': SystemReadyPayload;
  'turn.started': TurnStartedPayload;
  'turn.step_started': TurnStepStartedPayload;
  'turn.delta': TurnDeltaPayload;
  'turn.tool_call': TurnToolCallPayload;
  'turn.tool_result': TurnToolResultPayload;
  'turn.end': TurnEndPayload;
  'task.changed': TaskChangedPayload;
  'rover.entry.appended': RoverEntryAppendedPayload;
  'rover.compaction.appended': RoverCompactionAppendedPayload;
  'inbox.changed': InboxChangedPayload;
  'inbox.provider.status': InboxProviderStatusPayload;
}

export type RuntimeEventType = keyof RuntimeEventMap;

export interface RuntimeEventEnvelope<K extends RuntimeEventType = RuntimeEventType> {
  type: K;
  payload: RuntimeEventMap[K];
  timestamp?: string;
}

export type RuntimeEventHandlers = {
  [K in RuntimeEventType]?: (
    payload: RuntimeEventMap[K],
    envelope: RuntimeEventEnvelope<K>
  ) => void;
} & {
  '*'?: (payload: unknown, envelope: RuntimeEventEnvelope<any>) => void;
};
