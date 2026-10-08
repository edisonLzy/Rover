import {
  openDatabase,
  runMigrations,
  type RoverDatabase,
} from './infrastructure/database/index.js';
import { ModelService } from './modules/models/index.js';
import { SkillService } from './modules/skills/index.js';
import { TaskService } from './modules/tasks/index.js';
import { AgentService } from './modules/agent/index.js';
import type { WebSocketManager } from './transport/websocket.js';

/**
 * 运行时轻量组合根 (Container / Composition Root)
 * 对标 traceability 中的 Container 设计，集中持有已实例化的服务单例，
 * 并作为 tRPC Context 注入至所有路由 procedure 中。
 */
export interface Container {
  db: RoverDatabase;
  modelService: ModelService;
  skillService: SkillService;
  taskService: TaskService;
  agentService: AgentService;
}

export interface CreateContainerOptions {
  wsManager: WebSocketManager;
  customConfigPath?: string;
  skillsDir?: string;
}

export function createContainer(options: CreateContainerOptions): Container {
  const db = openDatabase();
  runMigrations(db.raw);

  const modelService = new ModelService({ customConfigPath: options.customConfigPath });
  const skillService = new SkillService({ skillsDir: options.skillsDir });
  const taskService = new TaskService({
    db: db.raw,
  });

  const agentService = new AgentService({
    db,
    modelService,
    skillService,
    wsManager: options.wsManager,
  });

  return Object.freeze({
    db,
    modelService,
    skillService,
    taskService,
    agentService,
  });
}
