import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TaskCard, type TaskItem } from '../features/pet/components/TaskCard.js';
import { PetAvatar } from '../features/pet/components/PetAvatar.js';
import { PetBubble } from '../features/pet/PetBubble/index.js';
import { PendingQueue, type PendingPromptItem } from '../features/pet/components/PendingQueue.js';

const task: TaskItem = {
  id: 'task_123',
  goal: '发布支付功能到 QA',
  agent: 'claude',
  status: 'needs_intervention',
  progressText: '准备已完成，等待你在 Claude Code 中确认部署。',
  createdAt: 1000,
  updatedAt: 1200,
};
const queue: PendingPromptItem[] = [
  {
    id: 'q1',
    doc: {
      v: 1,
      parts: [
        { type: 'reference', kind: 'agent', id: 'codex', label: 'Codex' },
        { type: 'text', text: '补充测试用例' },
      ],
    },
    textSnippet: '@Codex 补充测试用例',
    createdAt: 1000,
  },
];

describe('Pet window prototype interaction states', () => {
  it('shows a confirmation entry and progress for a task requiring intervention', () => {
    const html = renderToString(<TaskCard task={task} onOpenTerminal={vi.fn()} />);
    expect(html).toContain('去确认');
    expect(html).toContain(task.progressText);
    expect(html).toContain('对应的 Agent Session');
  });

  it('renders completed Markdown summaries safely with a session entry', () => {
    const html = renderToString(
      <TaskCard
        task={{
          ...task,
          status: 'completed',
          resultText: '**已完成**\n\n- 测试通过\n- <script>alert(1)</script>',
        }}
        onOpenTerminal={vi.fn()}
      />
    );
    expect(html).toContain('<strong>已完成</strong>');
    expect(html).toContain('<li>测试通过</li>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('查看会话');
    expect(html).toContain('is-finished');
  });

  it('disables all session entries when the original session is unavailable', () => {
    const html = renderToString(
      <TaskCard
        task={{ ...task, status: 'failed', sessionRef: { availability: 'unavailable' } }}
        onOpenTerminal={vi.fn()}
      />
    );
    expect(html).toContain('会话不可用');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('is-unavailable');
  });

  it('uses the prototype pet and counts tasks needing attention', () => {
    const html = renderToString(
      <PetAvatar
        isOnline={true}
        state="alert"
        isExpanded={false}
        onToggleExpand={vi.fn()}
        attentionCount={2}
      />
    );
    expect(html).toContain('Rover 桌面宠物');
    expect(html).toContain('rover-pet.png');
    expect(html).toContain('2 个任务需要关注');
    expect(html).toContain('aria-expanded="false"');
  });

  it('keeps thinking bubbles dismissible and exposes the session action', () => {
    const html = renderToString(
      <PetBubble
        text="正在分析上下文…"
        isThinking
        onClose={vi.fn()}
        onOpenSession={vi.fn()}
        sessionLabel="去确认"
      />
    );
    expect(html).toContain('speech-spinner');
    expect(html).toContain('关闭气泡');
    expect(html).toContain('去确认');
  });

  it('shows queued references with continue and defer choices', () => {
    const html = renderToString(
      <PendingQueue
        queue={queue}
        onRemove={vi.fn()}
        onConfirmNext={vi.fn()}
        onDefer={vi.fn()}
        canProceed
      />
    );
    expect(html).toContain('@Codex 补充测试用例');
    expect(html).toContain('继续下一条');
    expect(html).toContain('暂不处理');
    expect(html).toContain('移除待处理 Prompt 1');
  });

  it('keeps deferred prompts visible and only offers continuation after the active turn', () => {
    const props = { queue, onRemove: vi.fn(), onConfirmNext: vi.fn(), onDefer: vi.fn() };
    expect(renderToString(<PendingQueue {...props} canProceed isDeferred />)).toContain(
      '已暂停继续处理'
    );
    expect(renderToString(<PendingQueue {...props} canProceed={false} />)).not.toContain(
      '继续下一条'
    );
  });
});
