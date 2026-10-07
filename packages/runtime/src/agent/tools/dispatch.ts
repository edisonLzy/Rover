import path from 'node:path';
import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { RoverDatabase } from '../../storage/types.js';
import {
  insertDispatchAttempt,
  updateDispatchAttemptStatus as dbUpdateDispatchAttemptStatus,
  commitTaskWithSession,
} from '../../storage/repositories/tasks.js';
import {
  AgentRegistry,
  defaultAgentRegistry,
  createDispatchAttempt as coreCreateDispatchAttempt,
  launchDispatch,
  confirmNativeSession,
} from '../../dispatch/dispatcher.js';
import { ScreenSessionCarrier, type SessionCarrier } from '../../dispatch/carrier.js';
import type { WebSocketManager } from '../../transport/websocket.js';
import type { TaskAgent } from '../../storage/types.js';

export const DispatchAgentParams = Type.Object({
  agent: Type.Union([Type.Literal('claude'), Type.Literal('opencode'), Type.Literal('codex')], {
    description:
      "The CLI coding agent to dispatch ('claude' is recommended default, 'opencode' or 'codex')",
  }),
  cwd: Type.String({
    description: 'Absolute path to the target working directory where the agent should execute',
  }),
  taskPrompt: Type.String({
    description: 'Detailed, self-contained task instructions and requirements for the coding agent',
  }),
});

export type DispatchAgentParamsType = Static<typeof DispatchAgentParams>;

export interface DispatchAgentToolOptions {
  db: RoverDatabase;
  carrier?: SessionCarrier;
  agentRegistry?: AgentRegistry;
  wsManager?: WebSocketManager;
  getCurrentTurnId?: () => string | undefined;
}

export function createDispatchAgentTool(
  options: DispatchAgentToolOptions
): AgentTool<typeof DispatchAgentParams> {
  const {
    db,
    carrier = new ScreenSessionCarrier(),
    agentRegistry = defaultAgentRegistry,
    wsManager,
    getCurrentTurnId,
  } = options;

  return {
    name: 'dispatch_agent',
    label: 'Dispatch Coding Agent',
    description:
      'Dispatch an external CLI coding agent (claude, opencode, or codex) to execute a task in a specific working directory.',
    parameters: DispatchAgentParams,
    async execute(toolCallId: string, params: DispatchAgentParamsType) {
      const { agent, cwd, taskPrompt } = params;

      // 1. Validate cwd is absolute
      if (!path.isAbsolute(cwd)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Working directory "cwd" must be an absolute path (received: "${cwd}"). Please clarify the absolute path with the user.`,
            },
          ],
          details: { error: 'invalid_cwd', cwd },
        };
      }

      const turnId = getCurrentTurnId?.() || 'turn_direct';

      // 2. Initialize DispatchAttempt model
      const coreAttempt = coreCreateDispatchAttempt(
        {
          agentType: agent as TaskAgent,
          cwd,
          prompt: taskPrompt,
        },
        agentRegistry
      );

      // 3. Write dispatch_attempt to database with status 'starting'
      // Red line: NO task is created at this point!
      insertDispatchAttempt(db.raw, {
        id: coreAttempt.attemptId,
        candidateTaskId: coreAttempt.reservedTaskUuid,
        sourceKind: 'turn',
        sourceId: turnId,
        agent: agent as TaskAgent,
        cwd,
        reportToken: coreAttempt.reportToken,
        status: 'starting',
      });

      // 4. Launch Carrier process
      let carrierSession;
      try {
        const launched = await launchDispatch(
          coreAttempt,
          {
            agentType: agent as TaskAgent,
            cwd,
            prompt: taskPrompt,
          },
          carrier,
          agentRegistry
        );
        carrierSession = launched.carrierSession;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        dbUpdateDispatchAttemptStatus(db.raw, coreAttempt.attemptId, 'failed', errorMsg);
        return {
          content: [
            {
              type: 'text',
              text: `Failed to launch ${agent} process: ${errorMsg}. No Task was created.`,
            },
          ],
          details: {
            error: 'launch_failed',
            attemptId: coreAttempt.attemptId,
            message: errorMsg,
          },
        };
      }

      // 5. Session Confirmation & Task Atomic Transaction
      if (coreAttempt.sessionIdStrategy === 'preallocated') {
        const nativeSessionId = coreAttempt.preallocatedSessionId!;
        confirmNativeSession(coreAttempt, nativeSessionId);

        // Atomic transaction: commit task, session_ref, task_event, advance attempt to registered
        const { task, sessionRef } = commitTaskWithSession(db.raw, {
          attemptId: coreAttempt.attemptId,
          taskId: coreAttempt.reservedTaskUuid,
          goal: taskPrompt,
          agent: agent as TaskAgent,
          nativeSessionId,
          configDir: cwd,
          carrierName: carrierSession.sessionName,
          carrierKind: carrier.carrierType,
          wsManager,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task successfully dispatched to ${agent}!\n- Task ID: ${task.id}\n- Native Session ID: ${sessionRef.nativeSessionId}\n- Carrier: ${sessionRef.carrierName}\n- Status: running\n- Workspace: ${cwd}`,
            },
          ],
          details: {
            taskId: task.id,
            nativeSessionId: sessionRef.nativeSessionId,
            carrierSessionName: carrierSession.sessionName,
            status: 'running',
            agent,
          },
        };
      } else {
        // Deferred strategy (e.g. Codex): Task creation deferred until SessionStart hook arrives
        return {
          content: [
            {
              type: 'text',
              text: `Task dispatch initiated for ${agent} (deferred session confirmation).\n- Dispatch Attempt ID: ${coreAttempt.attemptId}\n- Candidate Task ID: ${coreAttempt.reservedTaskUuid}\n- Carrier: ${carrierSession.sessionName}\n- Status: starting\n- Workspace: ${cwd}\nThe task will transition to running once native session start is confirmed.`,
            },
          ],
          details: {
            attemptId: coreAttempt.attemptId,
            candidateTaskId: coreAttempt.reservedTaskUuid,
            carrierSessionName: carrierSession.sessionName,
            status: 'starting',
            agent,
          },
        };
      }
    },
  };
}
