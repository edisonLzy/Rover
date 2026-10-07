import {
  openDatabase,
  runMigrations,
  type RoverDatabase,
} from './infrastructure/database/index.js';
import { ModelService, getModelRegistry } from './modules/models/index.js';
import { SkillService } from './modules/skills/index.js';
import { TaskService } from './modules/tasks/index.js';
import { AgentService, createAgentRuntime } from './modules/agent/index.js';
import { defaultSessionCarrier } from './infrastructure/dispatch/carrier.js';
import { defaultAgentRegistry } from './infrastructure/dispatch/dispatcher.js';
import { executeTerminalAction } from './infrastructure/dispatch/terminal.js';
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
  wsManager: WebSocketManager;
  customConfigPath?: string;
  skillsDir?: string;
}

export function createContainer(options: CreateContainerOptions): Container {
  const db = openDatabase();
  runMigrations(db.raw);

  const models = new ModelService(getModelRegistry(options.customConfigPath));
  const skills = new SkillService({ skillsDir: options.skillsDir });
  const tasks = new TaskService({
    db: db.raw,
    carrier: defaultSessionCarrier,
    registry: defaultAgentRegistry,
    executeTerminal: executeTerminalAction,
  });

  const agentRuntime = createAgentRuntime({
    db,
    skillsDir: options.skillsDir,
    customConfigPath: options.customConfigPath,
    wsManager: options.wsManager,
  });

  const agent = new AgentService({
    runtime: agentRuntime,
    db: db.raw,
  });

  return Object.freeze({
    db,
    models,
    skills,
    tasks,
    agent,
  });
}
