import { getDefaultDatabase, type RoverDatabase } from './infrastructure/database/index.js';
import { ModelService, getModelRegistry } from './modules/models/index.js';
import { SkillService } from './modules/skills/index.js';
import { TaskService } from './modules/tasks/index.js';
import {
  DefaultAgentService,
  getDefaultAgentRuntime,
  type AgentService,
  type AgentRuntime,
} from './modules/agent/index.js';
import { defaultSessionCarrier, type SessionCarrier } from './infrastructure/dispatch/carrier.js';
import { defaultAgentRegistry, type AgentRegistry } from './infrastructure/dispatch/dispatcher.js';
import {
  executeTerminalAction,
  type TerminalAction,
  type TerminalExecutionResult,
} from './infrastructure/dispatch/terminal.js';
import type { WebSocketManager } from './transport/websocket.js';

/**
 * 运行时轻量组合根 (Container / Composition Root)
 * 对标 traceability 中的 Container 设计，集中持有已实例化的服务单例，
 * 并作为 tRPC Context 注入至所有路由 procedure 中。
 */
export interface Container {
  db: RoverDatabase;
  models: ModelService;
  skills: SkillService;
  tasks: TaskService;
  agent: AgentService;
}

export interface CreateContainerOptions {
  db?: RoverDatabase;
  customConfigPath?: string;
  skillsDir?: string;
  carrier?: SessionCarrier;
  registry?: AgentRegistry;
  executeTerminal?: (action: TerminalAction) => Promise<TerminalExecutionResult>;
  wsManager?: WebSocketManager;
  agentRuntime?: AgentRuntime;
}

export function createContainer(options: CreateContainerOptions = {}): Container {
  const db = options.db ?? getDefaultDatabase();
  const models = new ModelService(getModelRegistry(options.customConfigPath));
  const skills = new SkillService({ skillsDir: options.skillsDir });
  const tasks = new TaskService({
    getDatabase: () => db.raw,
    carrier: options.carrier ?? defaultSessionCarrier,
    registry: options.registry ?? defaultAgentRegistry,
    executeTerminal: options.executeTerminal ?? executeTerminalAction,
  });

  const runtimeProvider = options.agentRuntime
    ? () => options.agentRuntime!
    : () => getDefaultAgentRuntime();

  const agent = new DefaultAgentService({
    getRuntime: runtimeProvider,
    getDatabase: () => db.raw,
  });

  return Object.freeze({
    db,
    models,
    skills,
    tasks,
    agent,
  });
}

let defaultContainer: Container | null = null;

export function getDefaultContainer(options?: CreateContainerOptions): Container {
  if (!defaultContainer || options) {
    defaultContainer = createContainer(options);
  }
  return defaultContainer;
}

export function resetDefaultContainer(): void {
  defaultContainer = null;
}
