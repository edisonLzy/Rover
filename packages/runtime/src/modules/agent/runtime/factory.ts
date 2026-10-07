import type { AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import { AgentRuntime } from './runtime.js';
import { TurnPersistenceCallbacks } from './callbacks/persistence.js';
import { WebSocketBroadcastCallbacks } from './callbacks/broadcast.js';
import { openDatabase, type RoverDatabase } from '../../../infrastructure/database/index.js';
import { ModelRegistry, getModelRegistry } from '../../models/index.js';
import { BuiltinSkillService } from '../../skills/index.js';
import { createReadSkillTool } from './tools/skill.js';
import { createDispatchAgentTool } from './tools/dispatch.js';
import type { WebSocketManager } from '../../../transport/websocket.js';

export interface AgentRuntimeFactoryOptions {
  db?: RoverDatabase;
  wsManager?: WebSocketManager;
  modelRegistry?: ModelRegistry;
  customConfigPath?: string;
  skillsDir?: string;
  skillService?: BuiltinSkillService;
  tools?: AgentTool[];
  streamFn?: StreamFn;
  systemPrompt?: string;
}

export function createAgentRuntime(options: AgentRuntimeFactoryOptions = {}): AgentRuntime {
  const dbInstance = options.db || openDatabase();
  const modelRegistry = options.modelRegistry || getModelRegistry(options.customConfigPath);
  const skillService =
    options.skillService || new BuiltinSkillService({ skillsDir: options.skillsDir });

  let runtimeRef: AgentRuntime;

  const defaultTools: AgentTool[] = [
    createReadSkillTool(skillService),
    createDispatchAgentTool({
      db: dbInstance,
      wsManager: options.wsManager,
      getCurrentTurnId: () => runtimeRef?.getCurrentTurnContext()?.turnId,
    }),
  ];

  const tools = options.tools || defaultTools;

  const runtime = new AgentRuntime({
    modelRegistry,
    skillService,
    tools,
    streamFn: options.streamFn,
    systemPrompt: options.systemPrompt,
  });
  runtimeRef = runtime;

  runtime.addEventCallbacks(new TurnPersistenceCallbacks(dbInstance));
  if (options.wsManager) {
    runtime.addEventCallbacks(
      new WebSocketBroadcastCallbacks({
        wsManager: options.wsManager,
        db: dbInstance.raw,
      })
    );
  }

  return runtime;
}
