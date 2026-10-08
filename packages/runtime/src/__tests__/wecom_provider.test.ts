import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WSAuthFailureError } from '@wecom/aibot-node-sdk';
import { WecomInboxProvider, type WecomConfig } from '../modules/inbox/providers/wecom.js';
import type { IncomingInboxEvent } from '../modules/inbox/types.js';

class MockWSClient extends EventEmitter {
  connect = vi.fn();
  disconnect = vi.fn();
  replyStream = vi.fn().mockResolvedValue(undefined);

  simulateConnected() {
    this.emit('connected');
  }

  simulateAuthenticated() {
    this.emit('authenticated');
  }

  simulateMessage(frame: any) {
    this.emit('message', frame);
  }

  simulateError(err: any) {
    this.emit('error', err);
  }
}

describe('WecomInboxProvider (Ticket 002)', () => {
  let mockClient: MockWSClient;
  let provider: WecomInboxProvider;
  const validConfig: WecomConfig = {
    botId: 'test_bot_123',
    botSecret: 'test_secret_456',
  };

  beforeEach(() => {
    mockClient = new MockWSClient();
    provider = new WecomInboxProvider({
      clientFactory: () => mockClient,
    });
  });

  describe('Identity & Initial State', () => {
    it('has correct provider metadata and starts in disabled state', () => {
      expect(provider.id).toBe('wecom');
      expect(provider.displayName).toBe('企业微信智能机器人');
      expect(provider.getStatus()).toBe('disabled');
    });
  });

  describe('Lifecycle & Status Transitions', () => {
    it('throws when starting with missing credentials', async () => {
      await expect(provider.start({ botId: '', botSecret: '' })).rejects.toThrow(
        /必须提供 botId 和 botSecret/
      );
      expect(provider.getStatus()).toBe('error');
    });

    it('transitions from connecting to connected upon authentication', async () => {
      const statusListener = vi.fn();
      provider.onStatusChange(statusListener);

      const startPromise = provider.start(validConfig);
      expect(mockClient.connect).toHaveBeenCalled();
      expect(provider.getStatus()).toBe('connecting');

      mockClient.simulateConnected();
      expect(provider.getStatus()).toBe('connecting');

      mockClient.simulateAuthenticated();
      expect(provider.getStatus()).toBe('connected');

      await startPromise;
      expect(statusListener).toHaveBeenCalledWith('connecting', undefined);
      expect(statusListener).toHaveBeenCalledWith('connected', undefined);
    });

    it('handles WSAuthFailureError by setting auth_failed and disconnecting', async () => {
      const statusListener = vi.fn();
      provider.onStatusChange(statusListener);

      await provider.start(validConfig);
      mockClient.simulateError(new WSAuthFailureError(3));

      expect(provider.getStatus()).toBe('disabled'); // stop() resets to disabled after disconnecting
      expect(statusListener).toHaveBeenCalledWith(
        'auth_failed',
        expect.stringContaining('Max auth failure attempts exceeded')
      );
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('gracefully stops and resets status to disabled', async () => {
      await provider.start(validConfig);
      mockClient.simulateAuthenticated();
      expect(provider.getStatus()).toBe('connected');

      await provider.stop();
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(provider.getStatus()).toBe('disabled');
    });
  });

  describe('Message Parsing & Dispatching', () => {
    it('parses text messages from group chat and dispatches IncomingInboxEvent', async () => {
      const dispatchedEvents: IncomingInboxEvent[] = [];
      provider.onMessage(async (event) => {
        dispatchedEvents.push(event);
      });

      await provider.start(validConfig);
      mockClient.simulateAuthenticated();

      const frame = {
        headers: { req_id: 'req_001' },
        body: {
          aibotid: 'test_bot_123',
          msgid: 'msg_1001',
          chatid: 'wrk_group_88',
          chattype: 'group',
          from: { userid: 'zhangsan' },
          msgtype: 'text',
          text: { content: '@bot 支付接口报 500 错误' },
        },
      };

      mockClient.simulateMessage(frame);

      expect(dispatchedEvents).toHaveLength(1);
      const event = dispatchedEvents[0];
      expect(event.sourceId).toBe('wecom');
      expect(event.sourceEventId).toBe('req_001');
      expect(event.sourceMessageId).toBe('msg_1001');
      expect(event.title).toBe('企业微信群聊 @ 提问');
      expect(event.summary).toBe('@bot 支付接口报 500 错误');
      expect(event.kind).toBe('wecom_mention');
      expect(event.payload).toMatchObject({
        chatId: 'wrk_group_88',
        senderId: 'zhangsan',
        chatType: 'group',
        msgType: 'text',
      });
    });

    it('parses single chat messages and marks title accordingly', async () => {
      const dispatchedEvents: IncomingInboxEvent[] = [];
      provider.onMessage(async (event) => {
        dispatchedEvents.push(event);
      });

      await provider.start(validConfig);

      const frame = {
        headers: { req_id: 'req_002' },
        body: {
          aibotid: 'test_bot_123',
          msgid: 'msg_1002',
          chattype: 'single',
          from: { userid: 'lisi' },
          msgtype: 'text',
          text: { content: '你好，私聊提问' },
        },
      };

      mockClient.simulateMessage(frame);

      expect(dispatchedEvents).toHaveLength(1);
      expect(dispatchedEvents[0].title).toBe('企业微信单聊提问');
      expect(dispatchedEvents[0].summary).toBe('你好，私聊提问');
    });

    it('extracts text from mixed and voice messages', async () => {
      const dispatchedEvents: IncomingInboxEvent[] = [];
      provider.onMessage(async (event) => {
        dispatchedEvents.push(event);
      });

      await provider.start(validConfig);

      // 1. Voice message
      mockClient.simulateMessage({
        body: {
          msgid: 'msg_voice_1',
          chattype: 'group',
          msgtype: 'voice',
          voice: { content: '语音转写文字内容' },
        },
      });

      // 2. Mixed message
      mockClient.simulateMessage({
        body: {
          msgid: 'msg_mixed_2',
          chattype: 'group',
          msgtype: 'mixed',
          mixed: {
            msg_item: [
              { msgtype: 'text', text: { content: '图片说明前置' } },
              { msgtype: 'image', image: { url: 'https://...' } },
              { msgtype: 'text', text: { content: '图片说明后置' } },
            ],
          },
        },
      });

      expect(dispatchedEvents).toHaveLength(2);
      expect(dispatchedEvents[0].summary).toBe('语音转写文字内容');
      expect(dispatchedEvents[1].summary).toBe('图片说明前置\n图片说明后置');
    });

    it('deduplicates identical frames in memory', async () => {
      const dispatchedEvents: IncomingInboxEvent[] = [];
      provider.onMessage(async (event) => {
        dispatchedEvents.push(event);
      });

      await provider.start(validConfig);

      const frame = {
        body: {
          aibotid: 'test_bot_123',
          msgid: 'msg_same',
          chattype: 'group',
          chatid: 'chat_1',
          from: { userid: 'u_1' },
          msgtype: 'text',
          text: { content: '重复消息' },
        },
      };

      mockClient.simulateMessage(frame);
      mockClient.simulateMessage(frame);

      expect(dispatchedEvents).toHaveLength(1);
    });
  });

  describe('testConnection Probe', () => {
    it('resolves success when probe client authenticates', async () => {
      const probeClient = new MockWSClient();
      const testProvider = new WecomInboxProvider({
        clientFactory: () => probeClient,
      });

      const testPromise = testProvider.testConnection(validConfig);
      probeClient.simulateAuthenticated();

      const result = await testPromise;
      expect(result.success).toBe(true);
      expect(result.message).toBe('企业微信认证成功');
      expect(probeClient.disconnect).toHaveBeenCalled();
    });

    it('resolves failure when probe client errors', async () => {
      const probeClient = new MockWSClient();
      const testProvider = new WecomInboxProvider({
        clientFactory: () => probeClient,
      });

      const testPromise = testProvider.testConnection(validConfig);
      probeClient.simulateError(new Error('密钥无效'));

      const result = await testPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('密钥无效');
      expect(probeClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('reply Stream Capability', () => {
    it('calls client.replyStream when rawFrame is available', async () => {
      await provider.start(validConfig);

      const rawFrame = { headers: { req_id: '123' }, body: {} };
      const event: IncomingInboxEvent = {
        sourceId: 'wecom',
        sourceEventId: '123',
        sourceMessageId: 'msg_1',
        kind: 'wecom_mention',
        title: 'Title',
        payload: { rawFrame },
      };

      await provider.reply(event, '排查完成，是空指针导致');

      expect(mockClient.replyStream).toHaveBeenCalledWith(
        rawFrame,
        expect.stringMatching(/^stream/),
        '排查完成，是空指针导致',
        true
      );
    });

    it('throws error when connection is closed or rawFrame is missing', async () => {
      const eventWithoutFrame: IncomingInboxEvent = {
        sourceId: 'wecom',
        sourceEventId: '123',
        sourceMessageId: 'msg_1',
        kind: 'wecom_mention',
        title: 'Title',
        payload: {},
      };

      await expect(provider.reply(eventWithoutFrame, 'text')).rejects.toThrow(
        /长连接已关闭或缺少原始消息句柄/
      );
    });
  });
});
