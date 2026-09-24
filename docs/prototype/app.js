(() => {
  const icons = {
    compose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7"/><path d="m15 5 4 4"/><path d="M11 17l3.2-.7L21 9.5a2.1 2.1 0 0 0-3-3l-6.8 6.8L11 17Z"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 10v4M7 6v12M11 3v18M15 8v8M19 5v14M23 10v4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M2 12h20"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7"/></svg>'
  };

  const scenarios = [
    ['home', '任务列表'], ['compact', '悬浮待命'], ['compose', '输入任务'],
    ['scheduled-demo', '创建定时任务'], ['slash-demo', 'Slash 引用 Skill'], ['attention', '需要你确认'],
    ['session', '会话跳转'], ['release-demo', 'QA 发布确认'],
    ['incident-demo', '故障排查'], ['resume-demo', '失败后续办'],
    ['inbox', '通知收件箱'], ['schedules', '定时计划'],
    ['skills', 'Skill 目录'], ['memory', '经验与草稿'], ['voice', '语音输入']
  ];

  const initialTasks = () => [
    {
      id: 'TASK-219', goal: '把 feature/payment 发布到 QA', title: 'feature/payment 发布 QA',
      status: 'needs_attention', kind: 'release', intent: 'deploy_to_qa', agent: 'Claude Code',
      skill: 'deploy-to-qa', project: 'customer-web', source: '用户派发', run: 'RUN-1', session: 'cld-qa219',
      summary: '发布准备已完成，等待你在 Claude Code 中确认部署。', attention: {
        type: 'approval', prompt: '是否允许推送 QA 分支并触发部署？',
        detail: '将 feature/payment 更新到远端 QA 分支，然后启动部署流程。'
      },
      events: ['Task 已创建；Rover 选中 deploy-to-qa', 'Claude Code Session 已启动', 'Agent 在 Session 请求用户确认']
    },
    {
      id: 'INC-482', goal: '排查线上结算页白屏', title: '线上结算页白屏',
      status: 'running', kind: 'incident', intent: 'investigate_incident', agent: 'Claude Code',
      skill: 'incident-investigation', project: 'customer-web', source: 'Sentry 告警', run: 'RUN-1',
      session: 'cld-7f2b', summary: '正在检查线上告警与结算页代码。', attention: null,
      events: ['告警触发 Task', 'Rover 选中 incident-investigation', 'Claude Code Session 正在分析']
    },
    {
      id: 'TASK-216', goal: '每天 09:30 检查支付链路告警', title: '设置支付链路健康巡检',
      status: 'completed', kind: 'scheduled', intent: 'create_scheduled_task', agent: 'Claude Code',
      skill: 'scheduled-task', project: 'customer-web', source: '用户派发', run: 'RUN-1',
      session: 'cld-sched216', summary: '计划已创建：每天 09:30', attention: null,
      result: '已设置每天 09:30 检查支付链路告警；首次触发后会生成新的 Task。',
      resultMd: '**已创建并验证定时计划**\n\n- 每天 **09:30** 检查支付链路告警\n- 到时触发新的 Task，保留执行记录。',
      events: ['Rover 选中 scheduled-task', 'Agent 在 Session 确认时间与内容', 'Agent 验证计划已创建', '结果已记录在 Task']
    },
    {
      id: 'TASK-215', goal: '复现登录失败问题', title: '登录问题复现',
      status: 'failed', kind: 'general', intent: 'general_task', agent: 'OpenCode',
      skill: null, project: 'auth-service', source: '用户派发', run: 'RUN-1',
      session: 'opc-215', summary: '执行器中断，可在原 Task 下重试', attention: null,
      result: '尚未完成复现；已有的日志与上下文仍保存在原 Task。',
      resultMd: '**未完成：执行器中断。**\n\n已保留日志与上下文；可在原 Task 下重试。',
      events: ['Task 已创建并交给 OpenCode', '执行器中断；本次 Run 失败']
    }
  ];

  const initialEpisodes = () => [{
    taskId: 'TASK-216', title: '支付链路巡检计划',
    summary: '确认频率与检查内容后创建计划，并验证首次触发方式。',
    scope: '适用于重复巡检；具体告警源仍需逐次确认。'
  }];

  const positionKey = 'roverDesktopPetPositionV1';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const inlineMarkdown = value => esc(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  function renderMarkdown(value) {
    return String(value || '').trim().split(/\n\s*\n/).filter(Boolean).map(block => {
      const lines = block.split('\n');
      return lines.every(line => /^- /.test(line))
        ? `<ul>${lines.map(line => `<li>${inlineMarkdown(line.slice(2))}</li>`).join('')}</ul>`
        : `<p>${lines.map(inlineMarkdown).join('<br>')}</p>`;
    }).join('');
  }
  const button = (label, action, type = '') => `<button class="action ${type}" data-action="${action}">${label}</button>`;

  function savedPosition() {
    try {
      const position = JSON.parse(localStorage.getItem(positionKey));
      return Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? { x: clamp(position.x, 47, 1873), y: clamp(position.y, 80, 1033) }
        : null;
    } catch { return null; }
  }

  const state = {
    view: 'compact', menu: false, plus: false, draft: '', agent: '自动分派', project: 'customer-web',
    selected: 'TASK-219', tasks: initialTasks(), episodes: initialEpisodes(),
    schedules: [{ title: '支付链路健康巡检', rule: '每天 09:30', sourceTask: 'TASK-216' }],
    skillDraft: { sourceTask: 'TASK-216', name: 'payment-health-check', status: 'draft' },
    voiceText: '', toast: '', petAnchor: savedPosition()
  };
  let toastTimer, zoomMode = 'fit', drag = null, lastDragAt = 0;

  const task = id => state.tasks.find(item => item.id === id);
  const current = () => task(state.selected) || state.tasks[0];
  const status = value => ({
    queued: ['排队中', 'gray'], running: ['进行中', ''],
    needs_attention: ['需要你确认', 'warn'], completed: ['已完成', 'green'],
    failed: ['失败', 'red'], cancelled: ['已取消', 'gray']
  })[value] || ['进行中', ''];

  function notify(message) {
    state.toast = message;
    render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.toast = ''; render(); }, 3200);
  }

  function route(goal) {
    const skillCommand = goal.trim().match(/^\/([a-z][a-z0-9-]*)\b/i)?.[1]?.toLowerCase();
    const mentionedAgent = goal.match(/@(Claude Code|Codex|OpenCode)/i)?.[1];
    const explicitAgent = mentionedAgent && ({ 'claude code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode' })[mentionedAgent.toLowerCase()];
    const cleanGoal = goal.replace(/^\s*\/[a-z][a-z0-9-]*\b\s*/i, '').replace(/@(Claude Code|Codex|OpenCode)/i, '').trim();
    const skillKinds = { 'scheduled-task': ['scheduled', 'create_scheduled_task'], 'deploy-to-qa': ['release', 'deploy_to_qa'], 'incident-investigation': ['incident', 'investigate_incident'] };
    if (skillCommand) {
      const known = skillKinds[skillCommand] || (state.skillDraft.status === 'saved' && skillCommand === state.skillDraft.name ? ['general', 'explicit_skill'] : null);
      if (!known) return { error: `未找到 Skill：/${skillCommand}` };
      return { goal: goal.trim(), kind: known[0], intent: known[1], skill: skillCommand,
        agent: explicitAgent || (known[0] === 'general' ? 'Codex' : 'Claude Code'), routeMode: explicitAgent ? 'slash_skill_at_agent' : 'slash_skill' };
    }
    if (explicitAgent) {
      return { goal: goal.trim(), kind: 'general', intent: 'direct_agent', skill: null,
        agent: explicitAgent, routeMode: 'at_agent' };
    }
    let kind = 'general', intent = 'general_task', skill = null;
    if (/定时|每天|每周|提醒/.test(cleanGoal)) {
      kind = 'scheduled'; intent = 'create_scheduled_task'; skill = 'scheduled-task';
    } else if (/部署|发布|\bQA\b/i.test(cleanGoal)) {
      kind = 'release'; intent = 'deploy_to_qa'; skill = 'deploy-to-qa';
    } else if (/白屏|告警|故障|排查/.test(cleanGoal)) {
      kind = 'incident'; intent = 'investigate_incident'; skill = 'incident-investigation';
    }
    return { goal: goal.trim(), kind, intent, skill,
      agent: kind === 'general' ? 'Codex' : 'Claude Code', routeMode: skill ? 'auto_skill' : 'auto_dispatch' };
  }

  function createTask(goal = $('#prompt')?.value.trim() || state.draft.trim()) {
    if (!goal) { notify('先输入要处理的任务'); return; }
    const selection = route(goal);
    if (selection.error) { notify(selection.error); return; }
    const next = Math.max(221, ...state.tasks.map(item => Number(item.id.match(/^TASK-(\d+)$/)?.[1] || 0))) + 1;
    const id = `TASK-${next}`;
    const item = {
      id, title: selection.goal.slice(0, 36), goal: selection.goal,
      status: 'running', ...selection, project: state.project, source: '用户派发',
      run: 'RUN-1', session: `${selection.agent === 'Codex' ? 'cdx' : selection.agent === 'OpenCode' ? 'opc' : 'cld'}-${next}`,
      summary: `${selection.agent} Session 已启动，正在理解任务目标。`, attention: null,
      events: [
        `${selection.routeMode === 'at_agent' ? '用户通过 @ 指定执行者，跳过自动业务 Skill 匹配' : selection.routeMode === 'slash_skill_at_agent' ? `用户指定 /${selection.skill} 和 @${selection.agent}` : selection.routeMode === 'slash_skill' ? `用户通过 /${selection.skill} 指定业务 Skill` : selection.skill ? `Rover 自动选中 ${selection.skill}` : 'Rover 未匹配到业务 Skill'}`,
        'Rover 按内置 agent-dispatch 派发；pet-task-state 提供状态回报约定',
        `${selection.agent} Session 已启动`
      ]
    };
    state.tasks.unshift(item);
    state.selected = id;
    state.draft = '';
    state.agent = '自动分派';
    go('home');
  }

  function requestAttention(item) {
    if (!item || item.status !== 'running') return;
    item.status = 'needs_attention';
    item.attention = item.kind === 'release'
      ? { type: 'approval', prompt: '是否允许推送 QA 分支并触发部署？', detail: '将目标分支更新到远端 QA 分支，然后启动部署流程。' }
      : { type: 'input', prompt: item.kind === 'scheduled' ? '请告诉我执行时间和任务内容。' : '请补充我继续执行所需的信息。', detail: 'Agent 会在收到回答后继续当前 Session。' };
    item.summary = item.kind === 'release' ? '发布准备已完成，等待你在 Agent Session 中确认部署。' : 'Agent 已暂停执行，等待你在原 Session 中补充信息。';
    item.events.push('Agent 在 Session 请求用户介入');
    go('home');
  }

  function advanceProgress(item) {
    if (!item || item.status !== 'running') return;
    const stages = item.kind === 'scheduled'
      ? ['正在核对执行频率与任务内容。', '已确定计划参数，正在验证创建结果。']
      : item.kind === 'release'
        ? ['正在检查 QA 发布条件。', '已完成发布准备，正在等待部署结果。']
        : item.kind === 'incident'
          ? ['已锁定 Sentry 中的结算页错误，正在核对受影响代码。', '已定位疑似原因，正在验证修复方向。']
          : ['正在检查任务所需的代码与资料。', '已形成处理方案，正在验证结果。'];
    item.progressStep = (item.progressStep || 0) + 1;
    item.summary = stages[(item.progressStep - 1) % stages.length];
    item.events.push(`Agent 状态更新：${item.summary}`);
    go('home');
  }

  function resolveAttention(item, answer, cancelled = false) {
    if (!item?.attention) return;
    if (cancelled) {
      item.status = 'cancelled';
      item.summary = '用户在 Agent Session 中取消了本次操作';
      item.result = '本次操作已取消；会话与已有记录仍保留。';
      item.resultMd = '**已取消。**\n\n本次操作未继续；已有记录仍保留在原 Task。';
      item.events.push('用户在 Agent Session 中取消；Task 已结束');
    } else {
      item.status = 'running';
      item.summary = `${item.agent} 已收到你的决定，继续执行`;
      item.answer = answer;
      item.events.push(`用户已在 Agent Session 中${item.attention.type === 'input' ? '补充信息' : '确认操作'}；Run 继续`);
    }
    item.attention = null;
    go('home');
  }

  function finishTask(item) {
    if (!item || item.status !== 'running') return;
    item.status = 'completed';
    item.result = item.kind === 'scheduled'
      ? `已设置${item.answer || '每天 09:30 执行目标任务'}，Agent 已验证计划。后续每次触发都会形成新的 Task。`
      : item.kind === 'release'
        ? 'QA 发布已完成，部署结果与验证信息已记录。'
        : item.kind === 'incident'
          ? '已完成白屏排查，根因、证据和后续建议已记录在本次 Session。'
          : 'Agent 已完成目标，结果与产物已记录在本次 Task。';
    item.summary = item.kind === 'scheduled' ? '定时计划已创建并验证' : '执行结果已回到 Task';
    item.resultMd = item.kind === 'scheduled'
      ? `**已创建并验证定时计划**\n\n- ${item.answer || '每天 09:30 执行目标任务'}\n- 到时触发新的 Task，保留执行记录。`
      : item.kind === 'release'
        ? '**QA 发布已完成。**\n\n- 部署结果已验证\n- 详细操作可通过「查看会话」打开原 Session。'
        : item.kind === 'incident'
          ? '**白屏排查已完成。**\n\n已记录根因、证据和后续建议；可打开原 Session 查看详情。'
          : '**任务已完成。**\n\n结果与产物已记录；可打开原 Session 查看详情。';
    item.events.push('Agent 按 pet-task-state 回报完成与结果', 'Rover 保存结果和本地经验');
    state.episodes.unshift({
      taskId: item.id, title: item.title,
      summary: item.result, scope: '来源于本次任务；下次使用仍需核对适用条件。'
    });
    if (item.kind === 'scheduled') {
      state.schedules.unshift({ title: item.title, rule: item.answer || '每天 09:30', sourceTask: item.id });
      state.skillDraft = { sourceTask: item.id, name: 'my-scheduled-check', status: 'draft' };
    }
    go('home');
  }

  function retryTask(item) {
    if (!item || !['failed', 'cancelled'].includes(item.status)) return;
    const number = Number(item.run.match(/\d+/)?.[0] || 1) + 1;
    item.run = `RUN-${number}`;
    item.session = `${item.agent === 'Codex' ? 'cdx' : item.agent === 'OpenCode' ? 'opc' : 'cld'}-${item.id.toLowerCase()}-${number}`;
    item.status = 'running';
    item.result = null;
    item.resultMd = null;
    item.summary = `${item.agent} 已在原 Task 下开始新的 Run`;
    item.events.push(`${item.run} 已启动；历史 Run 保留`);
    go('home');
  }

  function go(view) {
    state.view = view;
    state.menu = false;
    state.plus = false;
    render();
  }

  function taskCard(item) {
    if (!item) return '';
    const finished = ['completed', 'failed', 'cancelled'].includes(item.status);
    return `<article class="task-card task-summary-card ${finished ? 'is-finished' : 'is-processing'}" data-task="${esc(item.id)}"><button class="task-open" data-task="${esc(item.id)}" aria-label="打开 ${esc(item.goal)} 对应的 Agent Session">${esc(item.goal)}</button>${finished
      ? `<div class="task-markdown">${renderMarkdown(item.resultMd || item.result || item.summary)}</div><button class="action session-link" data-session-link="${esc(item.id)}">查看会话</button>`
      : `<div class="task-progress-row"><p class="task-progress">${esc(item.summary || '等待 Agent 更新状态。')}</p>${item.status === 'needs_attention' ? `<button class="action primary" data-confirm="${esc(item.id)}">去确认</button>` : ''}</div>`}</article>`;
  }

  function composer() {
    return `<div class="composer"><button class="circle-btn" data-action="plus" aria-label="选择执行者与工作区">${icons.plus}</button><input id="prompt" aria-label="给 Rover 的任务" placeholder="交给 Rover 一件事" value="${esc(state.draft)}"><button class="circle-btn send" data-action="send" aria-label="派发任务">${icons.up}</button></div>
      ${state.plus ? `<div class="option-card"><button data-action="agent-codex">@Codex</button><button data-action="agent-claude">@Claude Code</button><button data-action="agent-opencode">@OpenCode</button><select id="project" aria-label="工作区"><option ${state.project === 'customer-web' ? 'selected' : ''}>customer-web</option><option ${state.project === 'desktop-client' ? 'selected' : ''}>desktop-client</option><option ${state.project === 'auth-service' ? 'selected' : ''}>auth-service</option></select></div>` : ''}
      <div id="mentions" class="option-card hidden"><button data-action="agent-codex">@Codex</button><button data-action="agent-claude">@Claude Code</button><button data-action="agent-opencode">@OpenCode</button></div>`;
  }

  const back = label => `<div class="backline"><button data-action="back">‹ ${label || '返回任务'}</button><span>Rover · 产品交互演示</span></div>`;

  function home() {
    const processing = state.tasks.filter(item => !['completed', 'failed', 'cancelled'].includes(item.status)).sort((a, b) => Number(b.status === 'needs_attention') - Number(a.status === 'needs_attention'));
    const finished = state.tasks.filter(item => ['completed', 'failed', 'cancelled'].includes(item.status));
    return `${composer()}<div class="list task-list">${[...processing, ...finished].map(taskCard).join('') || '<div class="surface"><p>目前没有任务</p></div>'}</div>
      <div class="section-tiny">${button('Skill 目录', 'skills')}${button('经验记忆', 'memory')}</div>`;
  }

  function compact() {
    const count = state.tasks.filter(item => item.status === 'needs_attention').length;
    return `<div class="compact-controls"><button data-action="compose" aria-label="输入任务">${icons.compose}</button><button data-action="voice" aria-label="语音输入">${icons.voice}</button><button data-action="inbox" aria-label="通知">${icons.bell}${count ? `<em>${count}</em>` : ''}</button></div>`;
  }

  function compose() {
    return `${back('返回')} ${composer()}<div class="surface" style="margin-top:13px"><div class="overline">一个目标，一个可追踪的 Task</div><h2>三种输入方式</h2><p>只描述目标，Rover 判断是否需要 Skill；用 /scheduled-task 直接引用 Skill；用 @Claude Code 或 @Codex 将目标直接派给指定 Agent。具体讨论进入 Agent Session。</p><div class="actions">${button('演示普通输入', 'demo-scheduled', 'primary')}${button('演示 /Skill', 'demo-slash')}${button('查看 Skill 目录', 'skills')}</div></div>`;
  }

  function voice() {
    return `${back('返回')}<div class="surface" style="text-align:center"><div class="voice-wave"><span></span><span></span><span></span><span></span><span></span></div><h1>${state.voiceText ? '语音已转写' : '听你说'}</h1><p>${esc(state.voiceText || '点击按钮模拟一句任务输入。')}</p><div class="actions" style="justify-content:center">${button('模拟语音', 'simulate-voice', 'primary')}${state.voiceText ? button('编辑后派发', 'review-voice') : ''}</div></div>`;
  }

  function inbox() {
    const urgent = state.tasks.filter(item => item.status === 'needs_attention');
    const failed = state.tasks.filter(item => item.status === 'failed');
    return `${back('返回')}<div class="surface"><h1>需要你处理</h1><p>点击任务或「去确认」，直接定位到对应 Agent Session。</p></div><div class="list task-list">${[...urgent, ...failed].map(taskCard).join('') || '<div class="surface"><p>当前没有需要处理的任务。</p></div>'}</div>`;
  }

  function taskView() {
    const item = current();
    const [label, tone] = status(item.status);
    const skills = ['agent-dispatch', item.skill, 'pet-task-state'].filter(Boolean);
    return `${back('返回列表')}<div class="surface"><div class="title-row"><h1>${esc(item.title)}</h1><span class="status ${tone}">${label}</span></div>
      <p>${esc(item.id)} · ${esc(item.source)} · ${esc(item.project)}</p>
      ${['completed', 'failed', 'cancelled'].includes(item.status) ? `<div class="result-panel task-markdown">${renderMarkdown(item.resultMd || item.result || item.summary)}</div>` : `<p class="task-progress">${esc(item.summary)}</p>`}
      <div class="fine-line"></div><div class="overline">派发与 Skill</div><div class="info-grid"><div>入口<strong>${esc(({ auto_skill: 'Rover 自动判断', auto_dispatch: '普通任务派发', slash_skill: '/Skill 显式引用', slash_skill_at_agent: '/Skill + @Agent', at_agent: '@Agent 直接派发' })[item.routeMode] || '历史任务')}</strong></div><div>执行者<strong>${esc(item.agent)}</strong></div><div>业务 Skill<strong>${esc(item.skill || '未选用')}</strong></div><div>内置 Skill<strong>agent-dispatch · pet-task-state</strong></div></div>
      <div class="meta-row"><span>${esc(item.run)}</span><span>Session ${esc(item.session)}</span>${skills.map(name => `<span>${esc(name)}/SKILL.md</span>`).join('')}</div>
      <div class="actions">${button('查看会话', 'session', 'primary')}${item.status === 'completed' ? button('查看经验与 Skill 草稿', 'memory') : ''}</div></div>
      <div class="surface"><div class="overline">Task / Run 记录</div><div class="event-list">${item.events.map(event => `<div class="event"><b>${esc(event)}</b></div>`).join('')}</div></div>`;
  }

  function session() {
    const item = current();
    const controls = item.status === 'running'
      ? `${button('模拟进度更新', 'advance-progress')}${button('模拟 Agent 请求用户', 'request-attention')}${button('模拟 Agent 完成', 'finish-task', 'primary')}`
      : item.status === 'needs_attention'
        ? `${button('模拟在 Agent 中完成确认', 'session-resolve', 'primary')}${button('模拟在 Agent 中取消', 'session-cancel', 'danger')}`
        : ['failed', 'cancelled'].includes(item.status)
          ? button('在原 Task 下重试', 'retry-task', 'primary') : '';
    return `${back('返回任务列表')}<div class="surface"><div class="handoff-title">会话跳转占位 · ${esc(item.agent)}</div><h1>已定位到原 Agent Session</h1><p>真实产品在 ${esc(item.agent)} 中打开 ${esc(item.session)}。Rover 只保留跳转入口与任务摘要，不展示会话内容。</p><div class="conversation-meta"><span>${esc(item.id)}</span><span>${esc(item.run)}</span><span>${esc(item.session)}</span></div></div>
      <div class="surface"><div class="overline">原型事件控制</div><p>下列按钮只模拟 Coding Agent 的状态回报和用户在原会话中的操作。</p><div class="actions">${controls}${button('查看 Task 记录', 'task')}</div></div>`;
  }

  function schedules() {
    return `${back('返回')}<div class="surface"><h1>定时计划</h1><p>计划由 Agent 根据用户要求创建并验证。触发时，Rover 为这次执行建立新的 Task。</p></div>${state.schedules.map((entry, index) => `<div class="surface"><div class="title-row"><h2>${esc(entry.title)}</h2><span class="status green">${esc(entry.rule)}</span></div><p>创建来源：${esc(entry.sourceTask)}</p><div class="actions">${button(index === 0 ? '模拟到时触发' : '模拟触发', `trigger-schedule-${index}`, 'primary')}</div></div>`).join('')}`;
  }

  function skills() {
    const registry = [
      ['agent-dispatch', '内置', '指导 Rover 选择专业 Agent、派发目标并关联 Task 与 Session。'],
      ['pet-task-state', '内置', '指导 Agent 报告任务进度、用户介入与结果。每个 Run 都可获得。'],
      ['scheduled-task', '业务', '创建、修改与验证定时任务；缺信息时在 Session 提问。'],
      ['deploy-to-qa', '业务', '处理 QA 发布目标；需要用户决定时在 Session 发起请求。'],
      ['incident-investigation', '业务', '排查告警与故障，保留原因和证据。']
    ];
    if (state.skillDraft.status === 'saved') registry.push([state.skillDraft.name, '用户', '从已完成任务提炼，经用户审阅后启用。']);
    return `${back('返回')}<div class="surface"><h1>可用 Skill 目录</h1><p>每个 Skill 是包含 SKILL.md 的标准目录。Rover 按名称和描述轻量匹配；专业 Agent 读取完整目录。这里仅展示产品示意，不安装文件。</p></div>${registry.map(([name, scope, description]) => `<div class="surface"><div class="title-row"><h2>${esc(name)}</h2><span class="status ${scope === '内置' ? 'green' : ''}">${scope}</span></div><p>${esc(description)}</p><span class="code-chip">${esc(name)}/SKILL.md<br>references/ · scripts/ · assets/（按需）</span></div>`).join('')}${state.skillDraft.status === 'draft' ? `<div class="surface"><h2>待审阅：${esc(state.skillDraft.name)}</h2><p>草稿尚未加入可用目录。</p><div class="actions">${button('查看 Skill 草稿', 'skill-draft', 'primary')}</div></div>` : ''}`;
  }

  function memory() {
    return `${back('返回')}<div class="surface"><h1>本地经验</h1><p>Episode 保留来源和适用范围；相似任务可以引用为线索，执行 Agent 仍需核对。</p></div>${state.episodes.map(entry => `<div class="surface"><div class="title-row"><h2>${esc(entry.title)}</h2><span class="status">${esc(entry.taskId)}</span></div><p>${esc(entry.summary)}</p><div class="fine-line"></div><p>适用边界：${esc(entry.scope)}</p></div>`).join('')}${state.skillDraft.status === 'draft' ? `<div class="surface"><div class="overline">Self Improve · 待审阅</div><h2>把经验整理为 Skill？</h2><p>Rover 从 ${esc(state.skillDraft.sourceTask)} 提出了 ${esc(state.skillDraft.name)} 草稿。保存前请检查可复用性和敏感内容。</p><div class="actions">${button('查看 Skill 草稿', 'skill-draft', 'primary')}${button('忽略建议', 'ignore-draft')}</div></div>` : state.skillDraft.status === 'saved' ? `<div class="surface"><p>Skill 已保存并加入可用目录。</p><div class="actions">${button('查看 Skill 目录', 'skills', 'primary')}</div></div>` : ''}`;
  }

  function skillDraft() {
    if (state.skillDraft.status !== 'draft') return memory();
    const entry = state.skillDraft;
    return `${back('返回经验')}<div class="surface"><div class="title-row"><h1>审阅 Skill 草稿</h1><span class="status warn">未启用</span></div><p>来源 ${esc(entry.sourceTask)}。这是标准 Skill 目录的内容预览；保存后才会被 Rover 路由选中。</p><pre class="skill-preview">${esc(`---\nname: ${entry.name}\ndescription: 在用户要求重复检查支付链路告警时使用。\n---\n\n# 支付链路健康巡检\n\n1. 确认检查内容、频率与时区。\n2. 使用可用的计划能力创建任务。\n3. 验证计划已经保存，向用户回报下次触发时间。\n4. 按 pet-task-state 记录本次任务结果。\n\n适用范围：支付链路的重复巡检；具体告警源需重新核对。`)}</pre><div class="actions">${button('保存 Skill', 'save-draft', 'primary')}${button('忽略草稿', 'ignore-draft')}</div></div>`;
  }

  function renderChrome() {
    $('#roverShell').classList.toggle('session-view', state.view === 'session');
    const urgent = state.tasks.filter(item => item.status === 'needs_attention').length;
    const hint = state.view === 'task' && current().status === 'completed' ? '任务结果已记录' : '';
    $('#petArea').innerHTML = `<img class="pet" src="./assets/rover-pet.png" alt="Rover 桌面宠物，拖动可移动，点击可收起或展开" draggable="false" data-action="pet">${urgent ? `<span class="pet-attention">${urgent}</span>` : ''}${hint ? `<span class="pet-hint">${hint}</span>` : ''}`;
    $('#sceneMenu').classList.toggle('hidden', !state.menu);
    $('#sceneMenu').innerHTML = scenarios.map(([id, label]) => `<button class="${state.view === id ? 'selected' : ''}" data-view="${id}">${label}</button>`).join('');
    $('#toastMount').innerHTML = state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : '';
  }

  function render() {
    renderChrome();
    $('#main').innerHTML = ({
      home, compact, compose, voice, inbox, task: taskView, session,
      schedules, skills, memory, 'skill-draft': skillDraft
    })[state.view]?.() || home();
    applyPetPosition();
    layout();
  }

  function applyPetPosition() {
    const shell = $('#roverShell');
    if (!state.petAnchor) {
      shell.classList.remove('flip-up');
      for (const property of ['left', 'top', 'right', 'bottom']) shell.style[property] = '';
      for (const property of ['--pet-shift', '--pet-shift-y', '--controls-shift', '--controls-shift-y']) shell.style.removeProperty(property);
      return;
    }
    const { x, y } = state.petAnchor;
    shell.classList.remove('flip-up');
    let height = shell.offsetHeight;
    const width = shell.offsetWidth, petHalf = $('#petArea').offsetHeight / 2, topMin = 33;
    let topMax = Math.max(topMin, 1080 - height);
    const normalTop = y - petHalf, flippedTop = y - (height - petHalf);
    const flip = Math.abs(clamp(flippedTop, topMin, topMax) - flippedTop) < Math.abs(clamp(normalTop, topMin, topMax) - normalTop);
    shell.classList.toggle('flip-up', flip);
    height = shell.offsetHeight;
    topMax = Math.max(topMin, 1080 - height);
    const desiredTop = flip ? y - (height - petHalf) : y - petHalf;
    const top = clamp(desiredTop, topMin, topMax), left = clamp(x - width / 2, 0, 1920 - width);
    shell.style.left = `${left}px`; shell.style.top = `${top}px`;
    shell.style.right = 'auto'; shell.style.bottom = 'auto';
    shell.style.setProperty('--pet-shift', `${x - left - width / 2}px`);
    shell.style.setProperty('--pet-shift-y', `${desiredTop - top}px`);
    shell.style.setProperty('--controls-shift', `${clamp(x, 101, 1819) - left - width / 2}px`);
    shell.style.setProperty('--controls-shift-y', `${desiredTop - top}px`);
  }

  function layout() {
    const viewport = $('#desktopViewport'), frame = $('#desktopFrame');
    const availableWidth = Math.max(290, innerWidth - 28), availableHeight = Math.max(240, innerHeight - 135);
    if (zoomMode === 'fit') {
      const scale = Math.min(availableWidth / 1920, availableHeight / 1080, 1);
      viewport.style.width = `${1920 * scale}px`; viewport.style.height = `${1080 * scale}px`;
      viewport.style.overflow = 'hidden'; frame.style.transform = `scale(${scale})`;
      viewport.scrollLeft = 0; viewport.scrollTop = 0;
      $('#scaleLabel').textContent = `整屏比例 ${Math.round(scale * 100)}% · 画布为 1920 × 1080`;
    } else {
      const width = Math.min(availableWidth, 780), height = Math.min(availableHeight, 690);
      viewport.style.width = `${width}px`; viewport.style.height = `${height}px`;
      viewport.style.overflow = 'auto'; frame.style.transform = 'none';
      requestAnimationFrame(() => {
        if (state.petAnchor) {
          const shell = $('#roverShell');
          viewport.scrollLeft = clamp(shell.offsetLeft + shell.offsetWidth / 2 - width / 2, 0, 1920 - width);
          viewport.scrollTop = clamp(shell.offsetTop + shell.offsetHeight / 2 - height / 2, 0, 1080 - height);
        } else {
          viewport.scrollLeft = Math.min(1920 - width, state.view === 'session' ? 1190 : 1920);
          viewport.scrollTop = state.view === 'session'
            ? clamp($('#roverShell').offsetTop - 12, 0, 1080 - height)
            : 1080 - height;
        }
      });
      $('#scaleLabel').textContent = 'Rover 局部 100% · 可滚动查看桌面';
    }
    $('#fitButton').classList.toggle('active', zoomMode === 'fit');
    $('#focusButton').classList.toggle('active', zoomMode === 'focus');
  }

  function showScenario(id) {
    if (id === 'scheduled-demo') { createTask('帮我设置一个定时任务'); return; }
    if (id === 'slash-demo') { createTask('/scheduled-task 每天 09:30 检查支付链路告警'); return; }
    if (id === 'release-demo' || id === 'attention') { state.selected = 'TASK-219'; go('home'); return; }
    if (id === 'incident-demo') { state.selected = 'INC-482'; go('home'); return; }
    if (id === 'resume-demo') { state.selected = 'TASK-215'; go('home'); return; }
    if (id === 'session') state.selected = 'TASK-219';
    go(id);
  }

  function handleAction(action) {
    const item = current();
    if (action.startsWith('trigger-schedule-')) {
      const entry = state.schedules[Number(action.split('-').at(-1))];
      if (entry) {
        createTask(`检查${entry.title}`);
        const created = current();
        created.source = `定时触发 · ${entry.sourceTask}`;
        created.events.unshift(`计划 ${entry.rule} 已触发`);
        render();
      }
      return;
    }
    switch (action) {
      case 'zoom-fit': zoomMode = 'fit'; layout(); break;
      case 'zoom-focus': zoomMode = 'focus'; layout(); break;
      case 'reset-position': state.petAnchor = null; try { localStorage.removeItem(positionKey); } catch {} render(); break;
      case 'scene-menu': state.menu = !state.menu; render(); break;
      case 'pet': if (Date.now() - lastDragAt > 350) go(state.view === 'compact' ? 'home' : 'compact'); break;
      case 'back': go(state.view === 'task' ? 'session' : state.view === 'skill-draft' ? 'memory' : 'home'); break;
      case 'compose': case 'voice': case 'inbox': case 'home': case 'task': case 'session': case 'schedules': case 'skills': case 'memory': case 'skill-draft': go(action); break;
      case 'completed-list': state.selected = state.tasks.find(entry => entry.status === 'completed')?.id || state.selected; go('home'); break;
      case 'plus': state.plus = !state.plus; render(); $('#prompt')?.focus(); break;
      case 'send': createTask(); break;
      case 'demo-scheduled': createTask('帮我设置一个定时任务'); break;
      case 'demo-slash': createTask('/scheduled-task 每天 09:30 检查支付链路告警'); break;
      case 'agent-codex': case 'agent-claude': case 'agent-opencode': {
        const agent = action === 'agent-codex' ? 'Codex' : action === 'agent-claude' ? 'Claude Code' : 'OpenCode';
        state.agent = agent;
        state.draft = `@${agent} ${state.draft.replace(/^@(Codex|Claude Code|OpenCode)\s*/i, '')}`;
        state.plus = false;
        render(); $('#prompt')?.focus(); break;
      }
      case 'request-attention': requestAttention(item); break;
      case 'advance-progress': advanceProgress(item); break;
      case 'session-resolve': resolveAttention(item, item.kind === 'scheduled' ? '每天 09:30 检查支付链路告警' : '已在原 Session 确认'); break;
      case 'session-cancel': resolveAttention(item, '', true); break;
      case 'finish-task': finishTask(item); break;
      case 'retry-task': retryTask(item); break;
      case 'simulate-voice': state.voiceText = '@Claude Code 帮我设置每天 09:30 的支付链路巡检'; render(); break;
      case 'review-voice': state.draft = state.voiceText; go('compose'); break;
      case 'save-draft': state.skillDraft.status = 'saved'; go('skills'); break;
      case 'ignore-draft': state.skillDraft.status = 'ignored'; go('memory'); break;
    }
  }

  document.addEventListener('click', event => {
    const scenario = event.target.closest('[data-view]');
    if (scenario) { showScenario(scenario.dataset.view); return; }
    const confirmation = event.target.closest('[data-confirm]');
    if (confirmation) { state.selected = confirmation.dataset.confirm; go('session'); return; }
    const sessionLink = event.target.closest('[data-session-link]');
    if (sessionLink) { state.selected = sessionLink.dataset.sessionLink; go('session'); return; }
    const selectedTask = event.target.closest('[data-task]');
    if (selectedTask) { state.selected = selectedTask.dataset.task; go('session'); return; }
    const action = event.target.closest('[data-action]');
    if (action) handleAction(action.dataset.action);
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'prompt') {
      state.draft = event.target.value;
      $('#mentions')?.classList.toggle('hidden', !/@[^\s，,]*$/.test(state.draft));
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'project') state.project = event.target.value;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { state.menu = false; if (state.view !== 'compact') go('compact'); else render(); }
    if (event.key === 'Enter' && event.target.id === 'prompt') { event.preventDefault(); createTask(); }
  });
  addEventListener('resize', layout);

  document.addEventListener('dragstart', event => { if (event.target.closest('.pet')) event.preventDefault(); });
  document.addEventListener('pointerdown', event => {
    const pet = event.target.closest('.pet');
    if (!pet || event.button !== 0) return;
    const frame = $('#desktopFrame').getBoundingClientRect();
    const rect = pet.getBoundingClientRect();
    const scale = frame.width / 1920;
    drag = {
      id: event.pointerId, startX: event.clientX, startY: event.clientY,
      anchorX: (rect.left + rect.width / 2 - frame.left) / scale,
      anchorY: (rect.top + rect.height / 2 - frame.top) / scale,
      scale, moved: false, pet
    };
    pet.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.pet.classList.add('dragging');
    state.petAnchor = {
      x: clamp(drag.anchorX + dx / drag.scale, 47, 1873),
      y: clamp(drag.anchorY + dy / drag.scale, 80, 1033)
    };
    applyPetPosition();
  });
  function finishPetDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved) {
      lastDragAt = Date.now();
      try { localStorage.setItem(positionKey, JSON.stringify(state.petAnchor)); } catch {}
      layout();
    }
    drag = null;
  }
  document.addEventListener('pointerup', finishPetDrag);
  document.addEventListener('pointercancel', finishPetDrag);

  render();
})();
