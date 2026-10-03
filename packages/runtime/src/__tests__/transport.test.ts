import { describe, expect, it, afterEach } from 'vitest';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import WebSocket from 'ws';
import { createRuntimeServer, RuntimeServer, type AppRouter } from '../transport/index.js';
import { RUNTIME_VERSION } from '../index.js';
import { fileURLToPath } from 'node:url';
import { BuiltinSkillService } from '../agent/skills/skill-service.js';
import { ModelRegistry } from '../models/registry.js';
import { getDefaultTurnEngine } from '../agent/index.js';

describe('Transport & Security Invariants (M0-2)', () => {
  let server: RuntimeServer | null = null;
  const validToken = 'rover-secret-token-xyz-123';

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('prohibits binding to 0.0.0.0 to prevent public network exposure', () => {
    expect(() => {
      new RuntimeServer({
        port: 0,
        token: validToken,
        host: '0.0.0.0',
      });
    }).toThrow(/Binding to 0.0.0.0 is prohibited/);
  });

  it('rejects empty authentication token during initialization', () => {
    expect(() => {
      new RuntimeServer({
        port: 0,
        token: '   ',
      });
    }).toThrow(/requires a non-empty auth token/);
  });

  it('serves host-provided skill metadata and bodies through authenticated queries', async () => {
    const skillsDir = fileURLToPath(new URL('../../../app/resources/skills/', import.meta.url));
    const expected = new BuiltinSkillService({ skillsDir }).getSkill('dispatch-agent')!;
    server = await createRuntimeServer({ port: 0, token: validToken, skillsDir });
    const { httpUrl } = server.getAddress();
    const client = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${httpUrl}/trpc`,
          headers: { Authorization: `Bearer ${validToken}` },
        }),
      ],
    });
    expect(await client.skills.list.query()).toContainEqual({
      id: expected.id,
      name: expected.name,
      description: expected.description,
      source: 'builtin',
      isEnabled: true,
    });
    expect(await client.skills.read.query({ name: expected.name })).toEqual({
      name: expected.name,
      body: expected.body,
    });
    await expect(client.skills.read.query({ name: 'missing' })).rejects.toThrow(/Skill not found/);
    const unauthenticated = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${httpUrl}/trpc` })],
    });
    await expect(unauthenticated.skills.list.query()).rejects.toThrow(/Unauthorized/);
    await expect(unauthenticated.skills.read.query({ name: expected.name })).rejects.toThrow(
      /Unauthorized/
    );
  });

  describe('REST /api/v1/health Probe', () => {
    it('returns 401 when request is missing authentication token', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const res = await fetch(`${httpUrl}/api/v1/health`);
      expect(res.status).toBe(401);
      const data = (await res.json()) as { error: string };
      expect(data.error).toMatch(/Unauthorized/i);
    });

    it('returns 401 when request contains invalid token', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const res = await fetch(`${httpUrl}/api/v1/health`, {
        headers: {
          Authorization: 'Bearer wrong-token',
        },
      });
      expect(res.status).toBe(401);
    });

    it('returns 200 with runtime status when valid Bearer token is provided', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const res = await fetch(`${httpUrl}/api/v1/health`, {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; version: string; uptime: number };
      expect(data.status).toBe('ok');
      expect(data.version).toBe(RUNTIME_VERSION);
      expect(typeof data.uptime).toBe('number');
    });
  });

  describe('tRPC End-to-End Client & Auth Middleware', () => {
    it('allows public procedure ping without token', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const client = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${httpUrl}/trpc`,
          }),
        ],
      });

      const result = await client.ping.query();
      expect(result).toBe('pong');
    });

    it('rejects protected procedure health query without auth token with UNAUTHORIZED', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const unauthedClient = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${httpUrl}/trpc`,
          }),
        ],
      });

      await expect(unauthedClient.health.query()).rejects.toThrow(/Unauthorized/i);
    });

    it('rejects protected procedure health query with invalid token with UNAUTHORIZED', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const invalidClient = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${httpUrl}/trpc`,
            headers: () => ({
              Authorization: 'Bearer invalid-token',
            }),
          }),
        ],
      });

      await expect(invalidClient.health.query()).rejects.toThrow(/Unauthorized/i);
    });

    it('succeeds for protected procedure health query with valid Bearer token', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const authedClient = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${httpUrl}/trpc`,
            headers: () => ({
              Authorization: `Bearer ${validToken}`,
            }),
          }),
        ],
      });

      const result = await authedClient.health.query();
      expect(result.status).toBe('ok');
      expect(result.version).toBe(RUNTIME_VERSION);
      expect(typeof result.uptime).toBe('number');
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('WebSocket /v1/events Native Protocol', () => {
    it('rejects unauthenticated WebSocket connection upgrade with HTTP 401', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { wsUrl } = server.getAddress();

      const wsWithoutToken = new WebSocket(wsUrl);

      const error = await new Promise<Error>((resolve) => {
        wsWithoutToken.on('error', (err) => resolve(err));
      });

      expect(error.message).toMatch(/401/);
    });

    it('rejects WebSocket connection with wrong token with HTTP 401', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { port, host } = server.getAddress();

      const wsWrongToken = new WebSocket(`ws://${host}:${port}/v1/events?token=wrong-secret`);

      const error = await new Promise<Error>((resolve) => {
        wsWrongToken.on('error', (err) => resolve(err));
      });

      expect(error.message).toMatch(/401/);
    });

    it('successfully connects with valid token, receives ready event, handles ping/pong, and receives broadcast', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { port, host } = server.getAddress();

      const ws = new WebSocket(`ws://${host}:${port}/v1/events?token=${validToken}`);

      const receivedMessages: string[] = [];

      ws.on('message', (data) => {
        receivedMessages.push(data.toString());
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', (err) => reject(err));
      });

      // Wait a moment for ready message
      await new Promise((r) => setTimeout(r, 50));
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
      const readyMsg = JSON.parse(receivedMessages[0]) as {
        type: string;
        payload: { version: string };
      };
      expect(readyMsg.type).toBe('system.ready');
      expect(readyMsg.payload.version).toBe(RUNTIME_VERSION);

      // Send ping message
      ws.send('ping');
      await new Promise((r) => setTimeout(r, 50));
      expect(receivedMessages).toContain('pong');

      // Test server event broadcast
      server.broadcast({
        type: 'task.changed',
        payload: { taskId: 'task-123', status: 'running' },
      });

      await new Promise((r) => setTimeout(r, 50));
      const broadcastMsg = receivedMessages
        .map((m) => {
          try {
            return JSON.parse(m) as { type: string; payload: { taskId: string } };
          } catch {
            return null;
          }
        })
        .find((m) => m?.type === 'task.changed');

      expect(broadcastMsg).toBeDefined();
      expect(broadcastMsg?.payload.taskId).toBe('task-123');

      ws.close();
    });
  });

  describe('History & Compaction tRPC Router', () => {
    it('queries history feed and stats via tRPC client', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const client = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${httpUrl}/trpc`,
            headers: {
              Authorization: `Bearer ${validToken}`,
            },
          }),
        ],
      });

      const stats = await client.history.getStats.query();
      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('totalMessages');
      expect(stats).toHaveProperty('totalCompactions');
      expect(stats).toHaveProperty('totalTurns');

      const feed = await client.history.getFeed.query();
      expect(Array.isArray(feed)).toBe(true);

      const effective = await client.history.getEffective.query();
      expect(effective).toHaveProperty('messages');
      expect(effective).toHaveProperty('latestSeq');
    });
  });

  describe('Models & Turns Active Model Guard (Active Model Resolution)', () => {
    it('queries models.getActive and accurately reports hasActiveModel', async () => {
      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const client = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${httpUrl}/trpc`,
            headers: {
              Authorization: `Bearer ${validToken}`,
            },
          }),
        ],
      });

      const activeRes = await client.models.getActive.query();
      expect(activeRes).toHaveProperty('hasActiveModel');
      expect(typeof activeRes.hasActiveModel).toBe('boolean');
    });

    it('rejects turns.start with PRECONDITION_FAILED when no active model is configured', async () => {
      const emptyRegistry = new ModelRegistry();
      emptyRegistry.saveConfig({ providers: {} });
      getDefaultTurnEngine({ modelRegistry: emptyRegistry });

      server = await createRuntimeServer({ port: 0, token: validToken });
      const { httpUrl } = server.getAddress();

      const client = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `${httpUrl}/trpc`,
            headers: {
              Authorization: `Bearer ${validToken}`,
            },
          }),
        ],
      });

      await expect(
        client.turns.start.mutate({
          promptDoc: {
            v: 1,
            parts: [{ type: 'text', text: 'Hello without model' }],
          },
        })
      ).rejects.toThrow(/No active model configured/);
    });
  });
});
