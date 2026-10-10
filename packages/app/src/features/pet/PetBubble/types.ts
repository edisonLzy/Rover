import type { HitlPayload } from '@rover/runtime/expose';

export type BubbleState =
  | { status: 'idle' }
  | { status: 'thinking' }
  | {
      status: 'tool_call';
      toolName: string;
      summary: string;
    }
  | {
      status: 'approval';
      requestId: string;
      kind: 'permission' | 'workspace_access' | 'doom_loop';
      summary: string;
      icon: '⚡' | '📂' | '⚠️';
      payload: HitlPayload;
    }
  | {
      status: 'result';
      content: string;
      isError?: boolean;
    };

export function isProcessing(
  state: BubbleState
): state is Extract<BubbleState, { status: 'thinking' | 'tool_call' | 'approval' }> {
  return state.status === 'thinking' || state.status === 'tool_call' || state.status === 'approval';
}

export function parseApprovalPayload(
  requestId: string,
  rawPayload: unknown
): {
  kind: 'permission' | 'workspace_access' | 'doom_loop';
  summary: string;
  icon: '⚡' | '📂' | '⚠️';
  payload: HitlPayload;
} {
  const payload = rawPayload as HitlPayload;

  if (payload && payload.kind === 'workspace_access') {
    return {
      kind: 'workspace_access',
      icon: '📂',
      summary: `访问: ${payload.targetPath || payload.resolvedPath || '外部目录'}`,
      payload,
    };
  }

  if (payload && payload.kind === 'permission') {
    const cmd = payload.command || (payload.args ? JSON.stringify(payload.args) : '受控命令');
    return {
      kind: 'permission',
      icon: '⚡',
      summary: `${payload.toolName || 'bash'}: ${cmd}`,
      payload,
    };
  }

  if (payload && payload.kind === 'doom_loop') {
    return {
      kind: 'doom_loop',
      icon: '⚠️',
      summary: `重复执行: ${payload.argsSummary || '未知调用'}`,
      payload,
    };
  }

  return {
    kind: 'doom_loop',
    icon: '⚠️',
    summary: '未知审批请求',
    payload: payload as HitlPayload,
  };
}

export function summarizeToolCall(toolName: string, args: unknown): string {
  if (typeof args === 'object' && args !== null) {
    const record = args as Record<string, unknown>;
    if (typeof record.command === 'string') {
      return `${toolName}: ${record.command}`;
    }
    if (typeof record.path === 'string') {
      return `${toolName}: ${record.path}`;
    }
    if (typeof record.targetPath === 'string') {
      return `${toolName}: ${record.targetPath}`;
    }
    const keys = Object.keys(record);
    if (keys.length > 0) {
      const firstVal = record[keys[0]];
      if (typeof firstVal === 'string' || typeof firstVal === 'number') {
        return `${toolName}: ${firstVal}`;
      }
    }
  }
  if (typeof args === 'string') {
    return `${toolName}: ${args}`;
  }
  return toolName;
}
