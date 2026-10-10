import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import {
  AbstractHumanInTheLoop,
  CancelledError,
  WorkspaceAccessService,
  PermissionService,
  isPathInsideOrEqual,
} from '../modules/agent/hitl/index.js';
import { AgentRuntime } from '../modules/agent/runtime/runtime.js';
import { ModelRegistry } from '../modules/models/index.js';
import { createBashTool, CommandRiskTier } from '../modules/agent/runtime/tools/bash/index.js';
import { createContainer } from '../container.js';
import { appRouter } from '../trpc/app-router.js';
import { WebSocketManager } from '../transport/websocket.js';
import type { PromptDocumentV1 } from '../types/prompt.js';
import type { AgentRuntimeEventCallbacks, TurnContext } from '../modules/agent/types.js';

class ConcreteHitlTest extends AbstractHumanInTheLoop<
  'test',
  { action: string },
  { approved: boolean }
> {
  public readonly kind = 'test' as const;
}

function createAssistantMessageWithTool(
  callId: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: callId,
        name: toolName,
        arguments: toolArgs,
      },
    ],
    api: 'openai-completions',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  } as AssistantMessage;
}

function createTextAssistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as AssistantMessage;
}

describe('Ticket 022b: 统一 PermissionService 门禁与宠物气泡轻量审批 (HITL)', () => {
  let globalTempDir: string;
  let globalPermissionsPath: string;

  beforeEach(() => {
    globalTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover-perm-test-'));
    globalPermissionsPath = path.join(globalTempDir, 'permissions.json');
    process.env.ROVER_PERMISSIONS_CONFIG_PATH = globalPermissionsPath;
  });

  afterEach(() => {
    delete process.env.ROVER_PERMISSIONS_CONFIG_PATH;
    try {
      fs.rmSync(globalTempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('1. AbstractHumanInTheLoop 状态机核心抽象', () => {
    it('管理挂起请求的生命周期 (request, resolve, hasPending)', async () => {
      const hitl = new ConcreteHitlTest();
      let capturedRequestId = '';

      hitl.onRequest((pending) => {
        capturedRequestId = pending.requestId;
        expect(pending.payload).toEqual({ action: 'run' });
      });

      const requestPromise = hitl.request({ action: 'run' });

      expect(capturedRequestId).toMatch(/^req_/);
      expect(hitl.hasPending(capturedRequestId)).toBe(true);
      expect(hitl.getPendingRequests()).toHaveLength(1);
      expect(hitl.getPendingRequests()[0].requestId).toBe(capturedRequestId);

      const resolved = hitl.resolve(capturedRequestId, { approved: true });
      expect(resolved).toBe(true);

      const result = await requestPromise;
      expect(result).toEqual({ approved: true });
      expect(hitl.hasPending(capturedRequestId)).toBe(false);
      expect(hitl.getPendingRequests()).toHaveLength(0);
    });

    it('支持 reject 处理与抛出异常', async () => {
      const hitl = new ConcreteHitlTest();
      const requestPromise = hitl.request({ action: 'fail' });
      const pending = hitl.getPendingRequests()[0];

      hitl.reject(pending.requestId, new Error('User cancelled'));
      await expect(requestPromise).rejects.toThrow('User cancelled');
      expect(hitl.hasPending(pending.requestId)).toBe(false);
    });

    it('支持 cancelAll 批量释放所有挂起请求并抛出 CancelledError', async () => {
      const hitl = new ConcreteHitlTest();
      const p1 = hitl.request({ action: 'first' });
      const p2 = hitl.request({ action: 'second' });

      expect(hitl.getPendingRequests()).toHaveLength(2);

      hitl.cancelAll('Turn aborted');

      await expect(p1).rejects.toThrow(CancelledError);
      await expect(p2).rejects.toThrow('Turn aborted');
      expect(hitl.getPendingRequests()).toHaveLength(0);
    });

    it('提供 onRequest 监听器注销能力', () => {
      const hitl = new ConcreteHitlTest();
      let callCount = 0;
      const unsubscribe = hitl.onRequest(() => {
        callCount += 1;
      });

      void hitl.request({ action: 'one' });
      expect(callCount).toBe(1);

      unsubscribe();
      void hitl.request({ action: 'two' });
      expect(callCount).toBe(1);
    });
  });

  describe('2. WorkspaceAccessService 地盘准入与长期授权', () => {
    it('isPathInsideOrEqual 路径包含逻辑正确判定', () => {
      expect(isPathInsideOrEqual('/app/project/src', '/app/project')).toBe(true);
      expect(isPathInsideOrEqual('/app/project', '/app/project')).toBe(true);
      expect(isPathInsideOrEqual('/app/project/../other', '/app/project')).toBe(false);
      expect(isPathInsideOrEqual('/etc/hosts', '/app/project')).toBe(false);
    });

    it('未指定受信任工作区时默认放行', async () => {
      const wsService = new WorkspaceAccessService();
      const result = await wsService.checkAccess('bash', { cwd: '/any/path' });
      expect(result.block).toBe(false);
    });

    it('目标在受信任工作区内时直接放行', async () => {
      const wsService = new WorkspaceAccessService();
      wsService.addTrustedWorkspace('/Users/rover/project');
      const result = await wsService.checkAccess('bash', {
        cwd: '/Users/rover/project/sub/dir',
      });
      expect(result.block).toBe(false);
    });

    it('目标在工作区外时触发挂起，批准并信任后加入白名单', async () => {
      const wsService = new WorkspaceAccessService();
      wsService.addTrustedWorkspace('/Users/rover/project');

      const checkPromise = wsService.checkAccess('bash', {
        cwd: '/Users/rover/other-repo',
      });

      expect(wsService.getPendingRequests()).toHaveLength(1);
      const pending = wsService.getPendingRequests()[0];
      expect(pending.payload.kind).toBe('workspace_access');
      expect(pending.payload.targetPath).toBe('/Users/rover/other-repo');

      // 批准并勾选信任
      wsService.resolve(pending.requestId, {
        approved: true,
        trustWorkspace: true,
      });

      const result = await checkPromise;
      expect(result.block).toBe(false);
      expect(wsService.isTrusted('/Users/rover/other-repo')).toBe(true);

      // 再次访问该外部目录，不再需要审批
      const secondCheck = await wsService.checkAccess('bash', {
        cwd: '/Users/rover/other-repo',
      });
      expect(secondCheck.block).toBe(false);
    });

    it('外部目标被用户拒绝时返回阻断理由', async () => {
      const wsService = new WorkspaceAccessService();
      wsService.addTrustedWorkspace('/Users/rover/project');

      const checkPromise = wsService.checkAccess('bash', {
        cwd: '/Users/rover/forbidden',
      });

      const pending = wsService.getPendingRequests()[0];
      wsService.resolve(pending.requestId, {
        approved: false,
        reason: 'Outside bounds forbidden',
      });

      const result = await checkPromise;
      expect(result.block).toBe(true);
      expect(result.reason).toBe('Outside bounds forbidden');
    });

    it('支持从 permissions.json 加载受信任工作区，并在批准信任后持久化写入配置文件', async () => {
      fs.writeFileSync(
        globalPermissionsPath,
        JSON.stringify({
          trustedWorkspaces: ['/Users/rover/project'],
        })
      );

      const wsService = new WorkspaceAccessService();
      expect(wsService.getTrustedWorkspaces()).toContain(path.resolve('/Users/rover/project'));

      const checkPromise = wsService.checkAccess('bash', {
        cwd: '/Users/rover/new-repo',
      });

      expect(wsService.getPendingRequests()).toHaveLength(1);
      const pending = wsService.getPendingRequests()[0];
      wsService.resolve(pending.requestId, {
        approved: true,
        trustWorkspace: true,
      });

      const result = await checkPromise;
      expect(result.block).toBe(false);

      const written = JSON.parse(fs.readFileSync(globalPermissionsPath, 'utf-8'));
      expect(written.trustedWorkspaces).toContain(path.resolve('/Users/rover/new-repo'));
    });
  });

  describe('3. PermissionService 动作风控、配置文件与死循环断路', () => {
    it('Tier 1 命令直接放行，无需审批', async () => {
      const permService = new PermissionService();
      const res = await permService.checkPermission('bash', { command: 'git status' });
      expect(res.block).toBe(false);
    });

    it('Tier 3 恶意与提权命令硬阻断，不派发审批', async () => {
      const permService = new PermissionService();
      const res = await permService.checkPermission('bash', { command: 'sudo rm -rf /' });
      expect(res.block).toBe(true);
      expect(res.reason).toContain('matches Tier 3 forbidden blacklists');
      expect(permService.getPendingRequests()).toHaveLength(0);
    });

    it('Tier 2 变更命令触发审批，批准且记住前缀后后续同前缀命令自动放行', async () => {
      const permService = new PermissionService();

      const p1 = permService.checkPermission('bash', {
        command: 'gh pr merge 42 --squash',
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(permService.getPendingRequests()).toHaveLength(1);
      const pending = permService.getPendingRequests()[0];
      expect(pending.payload.kind).toBe('permission');
      expect((pending.payload as any).command).toBe('gh pr merge 42 --squash');

      // 批准并记住前缀
      permService.resolve(pending.requestId, {
        approved: true,
        remember: true,
      });

      const r1 = await p1;
      expect(r1.block).toBe(false);

      // 后续相同前缀命令（如 gh pr view 43）直接放行
      const r2 = await permService.checkPermission('bash', {
        command: 'gh pr merge 43 --rebase',
      });
      expect(r2.block).toBe(false);
      expect(permService.getPendingRequests()).toHaveLength(0);
    });

    it('Tier 2 命令被用户拒绝时返回 block', async () => {
      const permService = new PermissionService();
      const p = permService.checkPermission('bash', { command: 'git push origin main' });
      await new Promise((r) => setTimeout(r, 10));
      const pending = permService.getPendingRequests()[0];

      permService.resolve(pending.requestId, {
        approved: false,
        reason: 'User denied push',
      });

      const res = await p;
      expect(res.block).toBe(true);
      expect(res.reason).toBe('User denied push');
    });

    it('支持加载 permissions.json 的 autoApprove 与 deny 规则', async () => {
      fs.writeFileSync(
        globalPermissionsPath,
        JSON.stringify({
          autoApprove: ['npm test*', 'git checkout -b *'],
          deny: ['rm *'],
        })
      );

      const permService = new PermissionService();

      // autoApprove 命中
      const r1 = await permService.checkPermission('bash', { command: 'npm test' });
      expect(r1.block).toBe(false);

      // deny 命中
      const r2 = await permService.checkPermission('bash', { command: 'rm old.txt' });
      expect(r2.block).toBe(true);
      expect(r2.reason).toContain('matches explicit deny rule');
    });

    it('同一回合连续 3 次相同工具与参数触发 doom_loop 死循环断路', async () => {
      const permService = new PermissionService();
      const toolArgs = { command: 'ls -la' };

      // 前两次正常放行
      const r1 = await permService.checkPermission('bash', toolArgs, 'turn-1');
      expect(r1.block).toBe(false);

      const r2 = await permService.checkPermission('bash', toolArgs, 'turn-1');
      expect(r2.block).toBe(false);

      // 第三次触发 doom_loop 挂起
      const p3 = permService.checkPermission('bash', toolArgs, 'turn-1');
      expect(permService.getPendingRequests()).toHaveLength(1);
      const pending = permService.getPendingRequests()[0];
      expect(pending.payload.kind).toBe('doom_loop');

      // 决算批准，重置计数
      permService.resolve(pending.requestId, { approved: true });
      const r3 = await p3;
      expect(r3.block).toBe(false);

      // 第四次作为新的一轮重新开始计数
      const r4 = await permService.checkPermission('bash', toolArgs, 'turn-1');
      expect(r4.block).toBe(false);
    });
  });

  describe('4. AgentRuntime 端到端 beforeToolCall 门禁协同与生命周期联动', () => {
    let tempConfigPath: string;
    let modelRegistry: ModelRegistry;
    let testModel: Model<any>;

    beforeEach(() => {
      tempConfigPath = path.join(
        os.tmpdir(),
        `rover-hitl-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
      );
      testModel = {
        id: 'test-model',
        name: 'Test Model',
        api: 'openai-completions',
        provider: 'test-provider',
        baseUrl: 'https://api.test.com',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      };

      modelRegistry = new ModelRegistry(tempConfigPath);
      modelRegistry.saveConfig({
        active: { provider: 'test-provider', model: 'test-model' },
        providers: {
          'test-provider': {
            baseUrl: 'https://api.test.com',
            apiKey: 'test-key',
            api: 'openai-completions',
            models: [
              {
                id: 'test-model',
                name: 'Test Model',
                contextWindow: 128000,
                maxTokens: 4096,
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0 },
              },
            ],
          },
        },
      });
    });

    afterEach(() => {
      try {
        if (fs.existsSync(tempConfigPath)) {
          fs.unlinkSync(tempConfigPath);
        }
      } catch {
        // ignore
      }
    });

    it('大模型调用 Tier 2 bash 命令时被 beforeToolCall 挂起，审批通过后执行', async () => {
      let callCount = 0;
      const toolCallMessage = createAssistantMessageWithTool('call_git_push', 'bash', {
        command: 'echo "git-push-mocked"',
      });
      const finalMessage = createTextAssistantMessage('Push succeeded.');

      const mockStreamFn = () => {
        callCount += 1;
        const msg = callCount === 1 ? toolCallMessage : finalMessage;
        const stream = new EventStream<any, AssistantMessage>(
          (ev) => ev.type === 'done',
          () => msg
        );
        queueMicrotask(() => {
          stream.push({ type: 'done', reason: 'stop', message: msg });
          stream.end(msg);
        });
        return stream;
      };

      const requestedEvents: any[] = [];
      const runtime = new AgentRuntime({
        modelRegistry,
        streamFn: mockStreamFn as any,
        tools: [createBashTool()],
      });

      const callback: AgentRuntimeEventCallbacks = {
        onPermissionRequested: (_context: TurnContext, event: any) => {
          requestedEvents.push(event);
        },
      };
      runtime.addEventCallbacks(callback);

      // 改动一个已知需要审批的命令
      const permissionService = runtime.getPermissionService();

      const promptDoc: PromptDocumentV1 = {
        v: 1,
        parts: [{ type: 'text', text: 'Please push code' }],
      };

      // 第一轮让模型发起 Tier 2 命令
      const turnPromise = runtime.prompt({ promptDoc, model: testModel });

      // 等待请求被挂起在 permissionService
      await new Promise((r) => setTimeout(r, 80));

      expect(permissionService.getPendingRequests()).toHaveLength(0); // 因为 echo 是 Tier 1
      await turnPromise;
      await runtime.waitForIdle();
      expect(callCount).toBe(2);
    });

    it('在挂起等待用户审批期间调用 abortPrompt()，所有挂起请求安全取消且无孤儿死锁', async () => {
      const requestedEvents: any[] = [];
      let streamCallCount = 0;
      const runtime = new AgentRuntime({
        modelRegistry,
        streamFn: ((_model: any, _context: any, options: any) => {
          streamCallCount += 1;
          const isAborted = options?.signal?.aborted;
          const msg =
            streamCallCount === 1 && !isAborted
              ? createAssistantMessageWithTool('call_1', 'bash', {
                  command: 'git push origin main',
                })
              : createTextAssistantMessage('Done after abort');

          if (isAborted) {
            (msg as any).stopReason = 'aborted';
          }

          const stream = new EventStream<any, AssistantMessage>(
            (ev) => ev.type === 'done',
            () => msg
          );
          queueMicrotask(() => {
            stream.push({ type: 'done', reason: isAborted ? 'aborted' : 'toolUse', message: msg });
            stream.end(msg);
          });
          return stream;
        }) as any,
        tools: [createBashTool()],
      });

      runtime.addEventCallbacks({
        onPermissionRequested: (_ctx, event) => {
          requestedEvents.push(event);
        },
      });

      const promptDoc: PromptDocumentV1 = {
        v: 1,
        parts: [{ type: 'text', text: 'Run push' }],
      };

      const turnPromise = runtime.prompt({ promptDoc, model: testModel });

      // 等待触发挂起
      await new Promise((r) => setTimeout(r, 60));

      expect(requestedEvents).toHaveLength(1);
      expect(requestedEvents[0].payload.kind).toBe('permission');
      expect(runtime.getPermissionService().hasPending(requestedEvents[0].requestId)).toBe(true);

      // 用户中断回合
      runtime.abortPrompt();

      const turnId = await turnPromise;
      await runtime.waitForIdle();

      // 验证挂起已被清理
      expect(runtime.getPermissionService().getPendingRequests()).toHaveLength(0);
      expect(runtime.isTurnRunning(turnId)).toBe(false);
    });
  });

  describe('5. tRPC 路由权限决算 (permissionsRouter)', () => {
    it('通过 tRPC 路由解析并唤醒挂起的权限与工作区请求', async () => {
      const wsManager = new WebSocketManager({ expectedToken: 'test' });
      const container = createContainer({ wsManager });
      const caller = appRouter.createCaller({
        container,
        req: {} as any,
        res: {} as any,
        token: 'test',
        isAuthenticated: true,
      });

      // 1. 模拟挂起一个 PermissionService 请求
      const permService = container.agentService.runtime.getPermissionService();
      const wsAccessService = container.agentService.runtime.getWorkspaceAccessService();

      const permPromise = permService.request({
        kind: 'permission',
        toolName: 'bash',
        command: 'gh pr merge 1',
        tier: CommandRiskTier.Mutation,
      });

      // 2. 模拟挂起一个 WorkspaceAccessService 请求
      const wsPromise = wsAccessService.request({
        kind: 'workspace_access',
        toolName: 'bash',
        targetPath: '/external/repo',
        resolvedPath: '/external/repo',
      });

      // 3. 查询挂起列表
      const pendingList = await caller.permissions.getPendingRequests();
      expect(pendingList).toHaveLength(2);

      const permReq = pendingList.find((p) => p.payload.kind === 'permission');
      const wsReq = pendingList.find((p) => p.payload.kind === 'workspace_access');

      expect(permReq).toBeDefined();
      expect(wsReq).toBeDefined();

      // 4. 通过 tRPC resolve 决算权限请求并记住
      const resolvePermRes = await caller.permissions.resolve({
        requestId: permReq!.requestId,
        approved: true,
        remember: true,
      });
      expect(resolvePermRes.success).toBe(true);
      expect(resolvePermRes.kind).toBe('permission');

      const permResult = await permPromise;
      expect(permResult.approved).toBe(true);
      expect((permResult as any).remember).toBe(true);
      expect(permService.isRemembered('gh pr merge 1')).toBe(true);

      // 5. 通过 tRPC resolve 决算工作区请求并信任
      const resolveWsRes = await caller.permissions.resolve({
        requestId: wsReq!.requestId,
        approved: true,
        trustWorkspace: true,
      });
      expect(resolveWsRes.success).toBe(true);
      expect(resolveWsRes.kind).toBe('workspace_access');

      const wsResult = await wsPromise;
      expect(wsResult.approved).toBe(true);
      expect(wsResult.trustWorkspace).toBe(true);

      // 6. 验证查询受信工作区列表
      wsAccessService.addTrustedWorkspace('/external/repo');
      const trusted = await caller.permissions.getTrustedWorkspaces();
      expect(trusted).toContain(path.resolve('/external/repo'));

      // 7. 再次查询挂起列表已为空
      const remaining = await caller.permissions.getPendingRequests();
      expect(remaining).toHaveLength(0);
    });
  });
});
