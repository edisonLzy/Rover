import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Message, Model } from '@earendil-works/pi-ai';
import {
  getDefaultDatabase,
  createRoverTurn,
  updateRoverTurnStatus,
  appendMessageEntry,
  getEffectiveHistory,
  getRoverTurn,
  getTurnEntries,
} from '../storage/index.js';
import type {
  RoverDatabase,
  RoverTurnRecord,
  RoverEntryRecord,
  AgentMessage as StorageAgentMessage,
} from '../storage/types.js';
import { type PromptDocumentV1, PromptDocumentV1Schema } from '../types/prompt.js';
import {
  parsePromptDocumentContent,
  buildRoverSystemPrompt,
  SystemPromptService,
} from './prompts.js';
import { AgentEventHandler, type TurnExecutionResult } from './handler.js';
import { ModelRegistry, getModelRegistry } from '../models/index.js';
import { assessContextBudget } from './compaction.js';
import type { WebSocketManager } from '../transport/websocket.js';
import { BuiltinSkillService } from './skills/skill-service.js';
import { createReadSkillTool } from './tools/skill.js';
import { createDispatchAgentTool } from './tools/dispatch.js';

export type { TurnExecutionResult };

export interface RoverTurnEngineOptions {
  db?: RoverDatabase;
  wsManager?: WebSocketManager;
  modelRegistry?: ModelRegistry;
  customConfigPath?: string;
  tools?: AgentTool[];
  skillsDir?: string;
  skillService?: BuiltinSkillService;
  streamFn?: StreamFn;
  systemPrompt?: string;
  handler?: AgentEventHandler;
}

export interface StartTurnInput {
  turnId?: string;
  promptDoc: PromptDocumentV1;
  model?: Model<any>;
  tools?: AgentTool[];
  signal?: AbortSignal;
}

interface InternalAgentConfig {
  turnId: string;
  model: Model<any>;
  systemPrompt: string;
  tools: AgentTool[];
  messages: AgentMessage[];
}

/**
 * RoverTurnEngine - Pi Agent Loop 回合引擎核心实现
 *
 * 代码风格与 Agent 编排完全对齐 divisor-agent (packages/app/src/main/agent-runtime.ts)，
 * 底层基于 @earendil-works/pi-agent-core 驱动 Agent 核心循环，
 * 并通过内聚的 AgentEventHandler 统一管理回合状态 (currentTurnId)、流式生命周期事件
 * 以及 ADR-0014 规定的 SQLite WAL 消息粒度先行落盘。
 */
export class RoverTurnEngine {
  private dbInstance: RoverDatabase;
  private wsManager?: WebSocketManager;
  private modelRegistry: ModelRegistry;
  private systemPromptService: SystemPromptService;
  private skillService: BuiltinSkillService;
  private tools: AgentTool[];
  private streamFn?: StreamFn;
  private handler: AgentEventHandler;
  private currentAgent: Agent | null = null;

  constructor(options: RoverTurnEngineOptions = {}) {
    this.dbInstance = options.db || getDefaultDatabase();
    this.wsManager = options.wsManager;
    this.modelRegistry = options.modelRegistry || getModelRegistry(options.customConfigPath);
    this.streamFn = options.streamFn;
    this.skillService =
      options.skillService || new BuiltinSkillService({ skillsDir: options.skillsDir });

    this.tools = options.tools || [
      createReadSkillTool(this.skillService),
      createDispatchAgentTool({
        db: this.dbInstance,
        wsManager: this.wsManager,
        getCurrentTurnId: () => this.currentTurnId || undefined,
      }),
    ];

    this.handler =
      options.handler ||
      new AgentEventHandler({
        db: this.db,
        wsManager: this.wsManager,
      });

    this.systemPromptService = new SystemPromptService();
    this.systemPromptService.addBuilder({
      buildSystemPrompt: (raw) => {
        const base = buildRoverSystemPrompt({
          tools: this.tools.map((t) => ({ name: t.name, description: t.description })),
          customInstructions: options.systemPrompt,
        });
        return raw ? `${base}\n\n${raw}` : base;
      },
    });
    this.systemPromptService.addBuilder(this.skillService);
  }

  public getSkillService(): BuiltinSkillService {
    return this.skillService;
  }

  public getTools(): AgentTool[] {
    return [...this.tools];
  }

  public get db(): Database.Database {
    return this.dbInstance.raw;
  }

  public get currentTurnId(): string | null {
    return this.handler.currentTurnId;
  }

  public getEventHandler(): AgentEventHandler {
    return this.handler;
  }

  public setWebSocketManager(wsManager: WebSocketManager) {
    this.wsManager = wsManager;
    this.handler.setWebSocketManager(wsManager);
  }

  public registerTool(tool: AgentTool) {
    this.tools.push(tool);
    if (this.currentAgent) {
      this.currentAgent.state.tools = [...this.tools];
    }
  }

  /**
   * Constructs the internal Pi Agent instance with WAL hooks & event subscriptions
   * for a specific turn lifecycle.
   */
  private createInternalAgent(config: InternalAgentConfig): Agent {
    const { model, systemPrompt, tools, messages } = config;

    const agent = new Agent({
      ...(this.streamFn ? { streamFn: this.streamFn } : {}),
      convertToLlm: (msgs) => {
        return msgs.flatMap((message): Message[] => {
          if (message.role === 'user') {
            return [
              {
                role: 'user',
                content: message.content,
                timestamp: message.timestamp,
              },
            ];
          }

          if (message.role === 'assistant' || message.role === 'toolResult') {
            return [message as Message];
          }

          return [];
        });
      },
      getApiKey: (provider) => {
        return this.modelRegistry.resolveApiKey(provider);
      },
      initialState: {
        model,
        systemPrompt,
        tools: [...tools],
        messages: [...messages],
      },
    });

    agent.subscribe((event) => this.handler.handle(event));

    return agent;
  }

  /**
   * Executes a complete Rover turn.
   */
  public async executeTurn(input: StartTurnInput): Promise<TurnExecutionResult> {
    const validDoc = PromptDocumentV1Schema.parse(input.promptDoc);
    const turnId = input.turnId || crypto.randomUUID();

    const parsedPrompt = parsePromptDocumentContent(validDoc);
    const userMessage: StorageAgentMessage = {
      role: 'user',
      content: parsedPrompt.plainText,
      timestamp: Date.now(),
    };

    // 1. Transaction: Atomically create rover_turn (status='running') and first user entry
    this.dbInstance.transaction(() => {
      createRoverTurn(this.db, {
        id: turnId,
        promptDoc: validDoc as unknown as Record<string, unknown>,
      });
      appendMessageEntry(this.db, {
        id: crypto.randomUUID(),
        turnId,
        message: userMessage,
      });
    });

    return new Promise<TurnExecutionResult>((resolve) => {
      // 2. Bind turn to handler
      this.handler.startTurn(turnId, (result) => {
        this.currentAgent = null;
        resolve(result);
      });
      this.handler.markPersisted(userMessage);

      // 3. Resolve Active Model (or input model override)
      const targetModel = input.model || this.modelRegistry.resolveActiveModel();
      if (!targetModel) {
        return resolve(this.handler.fail('No active model configured in ~/.rover/models.json'));
      }

      // 4. Assemble Effective History & Budget Assessment (ADR-0014)
      const effective = getEffectiveHistory(this.db);
      assessContextBudget(this.db, {
        modelMaxTokens: targetModel.contextWindow || 128000,
        safetyMarginTokens: 2000,
      });

      // System prompt with cumulative summary if present
      const summarySection = effective.compaction
        ? `\n\n[Cumulative Conversation History Summary]:\n${effective.compaction.data.summary}`
        : '';
      const systemPrompt = this.systemPromptService.buildSystemPrompt(summarySection);

      // Prepopulate agent history with prior effective messages (excluding current user message which will be prompted)
      const priorHistory = effective.messages
        .filter((e) => e.turnId !== turnId)
        .map((e) => e.data as unknown as AgentMessage);

      const tools = input.tools || this.tools;

      // 5. Instantiate internal Pi Agent with current turn scope
      const agent = this.createInternalAgent({
        turnId,
        model: targetModel,
        systemPrompt,
        tools,
        messages: priorHistory,
      });
      this.currentAgent = agent;

      // Handle external cancellation signal
      if (input.signal) {
        input.signal.addEventListener(
          'abort',
          () => {
            this.cancelTurn(turnId);
          },
          { once: true }
        );
      }

      // 6. Prompt agent to trigger the turn loop
      agent.prompt(userMessage as unknown as AgentMessage).catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.handler.fail(errorMsg);
      });
    });
  }

  /**
   * Actively cancels a running turn by ID.
   */
  public cancelTurn(turnId: string): boolean {
    if (this.handler.isTurnActive(turnId)) {
      const agent = this.currentAgent;
      if (agent) {
        updateRoverTurnStatus(this.db, {
          id: turnId,
          status: 'cancelled',
          error: 'Turn cancelled by user',
          completedAt: Date.now(),
        });
        agent.abort();
      } else {
        this.handler.cancel('Turn cancelled by user');
      }
      return true;
    }

    const turn = getRoverTurn(this.db, turnId);
    if (turn && turn.status === 'running') {
      updateRoverTurnStatus(this.db, {
        id: turnId,
        status: 'cancelled',
        error: 'Cancelled while inactive',
        completedAt: Date.now(),
      });
      return true;
    }

    return false;
  }

  public getTurnDetails(turnId: string): {
    turn: RoverTurnRecord | null;
    entries: RoverEntryRecord<StorageAgentMessage>[];
  } {
    const turn = getRoverTurn(this.db, turnId);
    const entries = getTurnEntries(this.db, turnId);
    return { turn, entries };
  }

  public isTurnRunning(turnId: string): boolean {
    return this.handler.isTurnActive(turnId);
  }

  public waitForIdle(): Promise<void> {
    if (this.currentAgent) {
      return this.currentAgent.waitForIdle();
    }
    return Promise.resolve();
  }

  public getDatabase(): Database.Database {
    return this.db;
  }
}

// Global default singleton
let defaultTurnEngine: RoverTurnEngine | null = null;

export function getDefaultTurnEngine(options?: RoverTurnEngineOptions): RoverTurnEngine {
  if (!defaultTurnEngine || options) {
    defaultTurnEngine = new RoverTurnEngine(options);
  }
  return defaultTurnEngine;
}
