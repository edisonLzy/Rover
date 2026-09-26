(() => {
  const icons = {
    compose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7"/><path d="m15 5 4 4"/><path d="M11 17l3.2-.7L21 9.5a2.1 2.1 0 0 0-3-3l-6.8 6.8L11 17Z"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 10v4M7 6v12M11 3v18M15 8v8M19 5v14M23 10v4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M2 12h20"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7"/></svg>'
  };

  const scenarios = [
    ['home', '任务列表'], ['compact', '悬浮待命'], ['compose', '输入问题或任务'],
    ['answer-demo', 'Rover 直接回答'], ['queue-demo', '连续输入与继续确认'], ['clarify-queue-demo', '澄清时排队'], ['rover-skill-demo', 'Rover 执行 Skill'], ['clarify-demo', 'Rover 询问补充'], ['weather-demo', '天气能力说明'],
    ['general-demo', '无 Skill 派发'], ['followup-demo', '创建后续任务'],
    ['scheduled-demo', '创建定时任务'], ['slash-demo', 'Slash 引用 Skill'], ['attention', '需要你确认'],
    ['session', '会话跳转'], ['release-demo', 'QA 发布确认'],
    ['incident-demo', '故障排查'], ['resume-demo', '失败后回到会话'],
    ['dashboard', '管理面板'], ['inbox', '通知收件箱'], ['schedules', '定时计划'],
    ['skills', 'Skill 目录'], ['memory', '经验与草稿'], ['voice', '语音输入']
  ];

  const initialTasks = () => [
    {
      id: 'TASK-219', goal: '把 feature/payment 发布到 QA', title: 'feature/payment 发布 QA',
      status: 'needs_attention', kind: 'release', intent: 'deploy_to_qa', agent: 'Claude Code',
      skill: 'deploy-to-qa', project: 'customer-web', source: '用户派发', session: 'cld-qa219',
      summary: '发布准备已完成，等待你在 Claude Code 中确认部署。', attention: {
        type: 'approval', prompt: '是否允许推送 QA 分支并触发部署？',
        detail: '将 feature/payment 更新到远端 QA 分支，然后启动部署流程。'
      },
      events: ['Task 已创建；Rover 选中 deploy-to-qa', 'Claude Code Session 已启动', 'Agent 在 Session 请求用户确认']
    },
    {
      id: 'INC-482', goal: '排查线上结算页白屏', title: '线上结算页白屏',
      status: 'running', kind: 'incident', intent: 'investigate_incident', agent: 'Claude Code',
      skill: 'incident-investigation', project: 'customer-web', source: 'Sentry 告警',
      session: 'cld-7f2b', summary: '正在检查线上告警与结算页代码。', attention: null,
      events: ['告警触发 Task', 'Rover 选中 incident-investigation', 'Claude Code Session 正在分析']
    },
    {
      id: 'TASK-216', goal: '每天 09:30 检查支付链路告警', title: '设置支付链路健康巡检',
      status: 'completed', kind: 'scheduled', intent: 'create_scheduled_task', agent: 'Claude Code',
      skill: 'scheduled-task', project: 'customer-web', source: '用户派发',
      session: 'cld-sched216', summary: '计划已创建：每天 09:30', attention: null,
      result: '已设置每天 09:30 检查支付链路告警；首次触发后会生成新的 Task。',
      resultMd: '**已创建并验证定时计划**\n\n- 每天 **09:30** 检查支付链路告警\n- 到时触发新的 Task，保留执行记录。',
      events: ['Rover 选中 scheduled-task', 'Agent 在 Session 确认时间与内容', 'Agent 验证计划已创建', '结果已记录在 Task']
    },
    {
      id: 'TASK-215', goal: '复现登录失败问题', title: '登录问题复现',
      status: 'failed', kind: 'general', intent: 'general_task', agent: 'OpenCode',
      skill: null, project: 'auth-service', source: '用户派发',
      session: 'opc-215', summary: 'API 请求失败，Agent 已停止处理', attention: null,
      result: 'Agent 的 API 请求失败，登录问题尚未完成复现。',
      resultMd: '**未完成：Agent 的 API 请求失败。**\n\n请到原 OpenCode Session 查看原因并继续处理。',
      events: ['Task 已创建并交给 OpenCode', 'API 请求失败，Agent 停止处理；Task 记录失败']
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
    view: 'compact', petMode: 'compact', menu: false, plus: false, draft: '', agent: '自动分派', project: 'customer-web',
    selected: 'TASK-219', tasks: initialTasks(), episodes: initialEpisodes(),
    speech: null, pendingClarification: null, pendingFollowup: null, lastDispatchedTaskId: null,
    replyMode: false, isDeciding: false, pendingPrompts: [], queueDeferred: false, queueReplyMode: false,
    roverHistory: [],
    schedules: [{ title: '支付链路健康巡检', rule: '每天 09:30', sourceTask: 'TASK-216' }],
    skillDraft: { sourceTask: 'TASK-216', name: 'payment-health-check', status: 'draft' },
    voiceText: '', toast: '', petAnchor: savedPosition()
  };
  let toastTimer, decisionTimer, speechTimer, decisionToken = 0, speechRevision = 0, nextPromptId = 1;
  let zoomMode = 'fit', drag = null, lastDragAt = 0;
  const transientSpeech = new Set(['thinking', 'clarify', 'followup-choice', 'dispatched', 'attention', 'warning']);

  const task = id => state.tasks.find(item => item.id === id);
  const current = () => task(state.selected) || state.tasks[0];
  const attentionCount = () => state.tasks.filter(item => ['needs_attention', 'failed'].includes(item.status)).length;
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

  function speak(status, message, taskId = null) {
    state.speech = { status, message, taskId };
    speechRevision++;
    render();
    scheduleSpeechDismiss();
  }

  function finishPrompt(status, message, taskId = null) {
    state.roverHistory.push({ role: 'assistant', content: message });
    speak(status, message, taskId);
  }

  function scheduleSpeechDismiss() {
    clearTimeout(speechTimer);
    if (!state.speech || !transientSpeech.has(state.speech.status)) return;
    if ($('#petArea .pet-speech')?.matches(':hover')) return;
    const revision = speechRevision;
    speechTimer = setTimeout(() => {
      if (revision !== speechRevision) return;
      state.speech = null;
      render();
    }, 10000);
  }

  function directDecision(goal) {
    if (/^\s*\/current-time\b/i.test(goal) && !/@(Claude Code|Codex|OpenCode)/i.test(goal)) {
      const now = new Date();
      const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
      const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(now);
      return { status: 'answer', message: `current-time Skill 由 Rover Agent 执行。现在是 ${date} ${time}；没有启动 Code Agent Session，也没有创建 Task。` };
    }
    if (/^\s*\/[a-z][a-z0-9-]*\b/i.test(goal) || /@(Claude Code|Codex|OpenCode)/i.test(goal)) return null;
    if (/天气|气温|下雨/.test(goal)) return {
      status: 'unavailable', message: '当前原型没有实时天气数据源，我无法可靠查询今天的天气。'
    };
    if (/^\s*(你好|嗨|hi|hello)[！!。.?？\s]*$/i.test(goal)) return {
      status: 'answer', message: '你好！可以直接问我简短问题，也可以交给我一件需要持续处理的事。'
    };
    if (/Rover.*(能做什么|是什么)|你能做什么/.test(goal)) return {
      status: 'answer', message: '我是 Rover Agent：可以直接回答或使用 Skill。Skill 启动本地 Code Agent Session 时，我会显示与该 Session 一对一对应的 Task。'
    };
    if (/今天(是几号|几月几日|几号)|现在几点/.test(goal)) {
      const now = new Date();
      const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
      const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(now);
      return { status: 'answer', message: `现在是 ${date} ${time}。` };
    }
    if (/^\s*帮我[。！？!?\s]*$/.test(goal)) return {
      status: 'clarify', message: '你希望我帮你做什么？说出目标后，我再决定直接回答还是创建 Task。'
    };
    return null;
  }

  function followupTarget(goal) {
    if (!/(继续|再|补充|加|改成|调整|修改|完善|顺便)/.test(goal)) return null;
    const explicitId = goal.match(/\b(?:TASK|INC)-\d+\b/i)?.[0].toUpperCase();
    if (explicitId) return { explicitId, candidateId: explicitId };
    if (/(刚才(?:那个|的)?|上一个任务|这个任务|任务\s*\d+)/.test(goal)) {
      return { explicitId: null, candidateId: state.lastDispatchedTaskId };
    }
    return null;
  }

  function createFollowupTask(source, instruction) {
    if (!source) return;
    const item = createTask(instruction, source);
    if (item) {
      state.pendingFollowup = null;
      finishPrompt('dispatched', `已根据 ${source.id} 建立新 Task ${item.id}，交给 ${item.agent} 处理。`, item.id);
    } else {
      finishPrompt('unavailable', state.lastRouteError || '这项后续任务暂时无法派发。');
    }
  }

  function submitPrompt(input = $('#prompt')?.value.trim() || state.draft.trim(), fromQueue = false) {
    if (!input) { notify('先输入问题或任务'); return; }
    if (state.isDeciding || (state.pendingPrompts.length && !fromQueue)) {
      state.pendingPrompts.push({ id: nextPromptId++, text: input });
      state.draft = '';
      state.replyMode = false;
      go('home');
      return;
    }
    clearTimeout(decisionTimer);
    const token = ++decisionToken;
    const prior = state.replyMode ? state.pendingClarification : null;
    state.pendingClarification = null;
    state.pendingFollowup = null;
    state.replyMode = false;
    const explicit = /^\s*\/[a-z][a-z0-9-]*\b/i.test(input) || /@(Claude Code|Codex|OpenCode)/i.test(input);
    // Combine text only for this prototype's route matching; the shared history stores the raw input.
    const goal = prior && !explicit && !/^\s*帮我/.test(input)
      ? `${prior.replace(/[。！？!?\s]+$/, '')}${input}` : input;
    state.draft = '';
    state.isDeciding = true;
    state.roverHistory.push({ role: 'user', content: input });
    state.speech = { status: 'thinking', message: '我看看怎么处理…', taskId: null };
    speechRevision++;
    go('home');
    scheduleSpeechDismiss();
    decisionTimer = setTimeout(() => {
      if (token !== decisionToken) return;
      state.isDeciding = false;
      const followup = followupTarget(goal);
      if (followup) {
        const item = followup.explicitId ? task(followup.explicitId) : null;
        if (followup.explicitId && !item) {
          finishPrompt('unavailable', `没有找到 ${followup.explicitId}，尚未创建新 Task。`);
        } else if (item) {
          createFollowupTask(item, goal);
        } else {
          state.pendingFollowup = { instruction: goal, candidateId: followup.candidateId };
          const candidate = task(followup.candidateId);
          finishPrompt('followup-choice', candidate
            ? `新任务要接续 ${candidate.id} 吗？请在任务列表选来源，Rover 会创建独立 Task。`
            : '这条输入像是接续已有任务。请在任务列表选来源，Rover 会创建独立 Task。');
        }
        return;
      }
      const direct = directDecision(goal);
      if (direct) {
        if (direct.status === 'clarify') {
          state.pendingClarification = goal;
          state.replyMode = !state.pendingPrompts.length && !state.draft.trim();
        }
        finishPrompt(direct.status, direct.message);
        return;
      }
      const item = createTask(goal);
      if (item) {
        const message = `已交给 ${item.agent}，可在任务列表查看进展。`;
        finishPrompt('dispatched', message, item.id);
      } else {
        const message = state.lastRouteError || '当前无法派发这项任务。';
        finishPrompt('unavailable', message);
      }
    }, 650);
  }

  function continueQueuedPrompt() {
    if (state.isDeciding || !state.pendingPrompts.length) return;
    const next = state.pendingPrompts.shift();
    state.replyMode = Boolean(state.pendingClarification && state.queueReplyMode);
    state.queueReplyMode = false;
    state.queueDeferred = false;
    submitPrompt(next.text, true);
  }

  function route(goal) {
    const skillCommand = goal.trim().match(/^\/([a-z][a-z0-9-]*)\b/i)?.[1]?.toLowerCase();
    const mentionedAgent = goal.match(/@(Claude Code|Codex|OpenCode)/i)?.[1];
    const explicitAgent = mentionedAgent && ({ 'claude code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode' })[mentionedAgent.toLowerCase()];
    const cleanGoal = goal.replace(/^\s*\/[a-z][a-z0-9-]*\b\s*/i, '').replace(/@(Claude Code|Codex|OpenCode)/i, '').trim();
    const skillKinds = { 'current-time': ['general', 'explicit_skill'], 'scheduled-task': ['scheduled', 'create_scheduled_task'], 'deploy-to-qa': ['release', 'deploy_to_qa'], 'incident-investigation': ['incident', 'investigate_incident'] };
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

  function createTask(goal = $('#prompt')?.value.trim() || state.draft.trim(), sourceTask = null) {
    if (!goal) { notify('先输入要处理的任务'); return null; }
    const selection = route(goal);
    if (selection.error) { state.lastRouteError = selection.error; return null; }
    if (sourceTask) {
      selection.intent = 'followup_task';
      selection.routeMode = 'followup_task';
      if (!/@(Claude Code|Codex|OpenCode)/i.test(goal)) selection.agent = sourceTask.agent;
    }
    const next = Math.max(221, ...state.tasks.map(item => Number(item.id.match(/^TASK-(\d+)$/)?.[1] || 0))) + 1;
    const id = `TASK-${next}`;
    const item = {
      id, title: selection.goal.slice(0, 36), goal: selection.goal,
      status: 'running', ...selection, project: sourceTask?.project || state.project,
      source: sourceTask ? `接续 ${sourceTask.id}` : '用户派发', sourceTaskId: sourceTask?.id || null,
      session: `${selection.agent === 'Codex' ? 'cdx' : selection.agent === 'OpenCode' ? 'opc' : 'cld'}-${next}`,
      summary: `${selection.agent} Session 已启动，正在理解${sourceTask ? `与 ${sourceTask.id} 相关的` : ''}任务目标。`, attention: null,
      events: [...(sourceTask ? [`新 Task 接续 ${sourceTask.id}；原 Task 与 Session 保持独立`] : []),
        `${selection.routeMode === 'at_agent' ? '用户通过 @ 指定执行者，跳过自动业务 Skill 匹配' : selection.routeMode === 'slash_skill_at_agent' ? `用户指定 /${selection.skill} 和 @${selection.agent}` : selection.routeMode === 'slash_skill' ? `用户通过 /${selection.skill} 指定业务 Skill` : selection.skill ? `Rover 自动选中 ${selection.skill}` : 'Rover 未匹配到业务 Skill'}`,
        'Rover 按内置 agent-dispatch 派发；pet-task-state 提供状态回报约定',
        `${selection.agent} Session 已启动${sourceTask ? '；携带来源 Task 的目标与已有摘要' : ''}`
      ]
    };
    state.tasks.unshift(item);
    state.lastDispatchedTaskId = id;
    state.selected = id;
    state.draft = '';
    state.agent = '自动分派';
    go('home');
    return item;
  }

  function requestAttention(item) {
    if (!item || item.status !== 'running') return;
    item.status = 'needs_attention';
    item.errorNotice = false;
    item.attention = item.kind === 'release'
      ? { type: 'approval', prompt: '是否允许推送 QA 分支并触发部署？', detail: '将目标分支更新到远端 QA 分支，然后启动部署流程。' }
      : { type: 'input', prompt: item.kind === 'scheduled' ? '请告诉我执行时间和任务内容。' : '请补充我继续执行所需的信息。', detail: 'Agent 会在收到回答后继续当前 Session。' };
    item.summary = item.kind === 'release' ? '发布准备已完成，等待你在 Agent Session 中确认部署。' : 'Agent 已暂停执行，等待你在原 Session 中补充信息。';
    item.events.push('Agent 在 Session 请求用户介入');
    go('home');
    speak('attention', `${item.agent} 需要你确认，请回到原会话。`, item.id);
  }

  function advanceProgress(item) {
    if (!item || item.status !== 'running') return;
    item.errorNotice = false;
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
      item.events.push(`用户已在 Agent Session 中${item.attention.type === 'input' ? '补充信息' : '确认操作'}；Task 继续`);
    }
    item.attention = null;
    go('home');
    speak(cancelled ? 'cancelled' : 'dispatched', cancelled
      ? `你已在 ${item.agent} 会话中取消操作，结果已记录。`
      : `${item.agent} 已收到你的决定，继续处理任务。`, item.id);
  }

  function finishTask(item) {
    if (!item || item.status !== 'running') return;
    item.status = 'completed';
    item.errorNotice = false;
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
    speak('completed', `${item.agent} 已完成「${item.title}」，结果已回到任务列表。`, item.id);
  }

  function showRecoverableError(item) {
    if (!item || item.status !== 'running') return;
    item.errorNotice = true;
    item.summary = 'Agent 遇到 API 错误，正在原会话中继续处理。';
    item.events.push('Agent 的 API 调用报错；原 Session 仍在处理，Task 保持处理中');
    go('home');
    speak('warning', `${item.agent} 遇到 API 错误，仍在原会话中处理。`, item.id);
    notify('Agent 遇到 API 错误，可查看原会话');
  }

  function failTask(item) {
    if (!item || item.status !== 'running') return;
    item.status = 'failed';
    item.errorNotice = false;
    item.summary = 'API 请求失败，Agent 已停止处理';
    item.result = 'Agent 的 API 请求失败，任务尚未完成。';
    item.resultMd = `**未完成：Agent 的 API 请求失败。**\n\n请到原 ${item.agent} Session 查看原因并继续处理。`;
    item.events.push('API 请求失败，Agent 停止处理；Task 记录失败');
    go('home');
    speak('failed', `${item.agent} 已停止处理，请查看任务结果和原会话。`, item.id);
    notify('任务未完成，请到原 Agent 会话查看原因');
  }

  function resumeInSession(item) {
    if (!item || item.status !== 'failed') return;
    item.events.push(`此前失败：${item.result || item.summary}`);
    item.status = 'running';
    item.result = null;
    item.resultMd = null;
    item.summary = `${item.agent} 已在原 Session 中继续处理。`;
    item.events.push('Agent 在原 Session 中继续；同一 Task 返回处理中');
    go('home');
    speak('dispatched', `${item.agent} 已在原会话继续处理。`, item.id);
  }

  function markSessionUnavailable(item) {
    if (!item || item.status !== 'failed') return;
    item.sessionAvailable = false;
    item.resultMd = `**原会话不可用。**\n\n${item.result || '任务尚未完成。'} Rover 已保留失败记录。`;
    item.events.push('原 Agent Session 无法打开；Task 保留失败记录');
    go('home');
    speak('failed', '原 Agent 会话不可用，任务记录已保留。', item.id);
    notify('原 Agent 会话不可用，任务记录已保留');
  }

  function go(view) {
    if (view === 'compose') {
      state.petMode = 'home';
      state.view = 'home';
      state.menu = false;
      render();
      $('#prompt')?.focus();
      return;
    }
    if (view === 'home' || view === 'compact') state.petMode = view;
    state.view = view;
    state.menu = false;
    state.plus = false;
    render();
  }

  function taskCard(item) {
    if (!item) return '';
    const finished = ['completed', 'failed', 'cancelled'].includes(item.status);
    return `<article class="task-card task-summary-card ${finished ? 'is-finished' : 'is-processing'}" data-task="${esc(item.id)}"><button class="task-open" data-task="${esc(item.id)}" aria-label="${item.sessionAvailable === false ? `查看 ${esc(item.goal)} 的会话不可用说明` : `打开 ${esc(item.goal)} 对应的 Agent Session`}">${esc(item.goal)}</button>${item.sourceTaskId ? `<div class="task-origin">接续 ${esc(item.sourceTaskId)} · 独立 Agent Session</div>` : ''}${finished
      ? `<div class="task-markdown">${renderMarkdown(item.resultMd || item.result || item.summary)}</div>${item.sessionAvailable === false ? '<span class="status warn">会话不可用</span>' : `<button class="action session-link" data-session-link="${esc(item.id)}">查看会话</button>`}`
      : `<div class="task-progress-row"><p class="task-progress">${esc(item.summary || '等待 Agent 更新状态。')}</p>${item.status === 'needs_attention' ? `<button class="action primary" data-confirm="${esc(item.id)}">去确认</button>` : item.status === 'running' && item.session ? `<button class="action" data-session-link="${esc(item.id)}">查看会话</button>` : ''}</div>`}${state.pendingFollowup ? `<button class="action followup-source" data-followup-source="${esc(item.id)}">以此任务为来源创建新 Task</button>` : ''}</article>`;
  }

  function composer() {
    const placeholder = state.replyMode ? '回答刚才的问题…' : '问 Rover，或交给它一件事';
    const hint = state.isDeciding
      ? '<div class="pending-question" role="status">Rover 正在处理当前输入；可以继续提交，后续 Prompt 会先存入界面队列。</div>'
      : state.pendingClarification
        ? state.pendingPrompts.length
          ? '<div class="pending-question">新提交的内容会排在队尾；下一条是否回答刚才的问题，请在队列中选择。</div>'
          : `<div class="pending-question clarification-mode">${state.replyMode ? '当前输入将回答刚才的问题。' : '当前输入将作为新问题处理。'} <button data-action="toggle-reply-mode">${state.replyMode ? '改为新问题' : '改为回答问题'}</button></div>`
        : state.pendingFollowup
          ? '<div class="pending-question">请选择一个来源任务创建新 Task；也可直接输入另一条新问题。</div>'
        : '';
    return `<div class="composer"><button class="circle-btn" data-action="plus" aria-label="选择执行者与工作区">${icons.plus}</button><input id="prompt" aria-label="问 Rover 或交办任务" placeholder="${placeholder}" value="${esc(state.draft)}"><button class="circle-btn send" data-action="send" aria-label="${state.isDeciding || state.pendingPrompts.length ? '加入待处理 Prompt' : '发送给 Rover'}">${icons.up}</button></div>${hint}
      ${state.plus ? `<div class="option-card"><button data-action="agent-codex">@Codex</button><button data-action="agent-claude">@Claude Code</button><button data-action="agent-opencode">@OpenCode</button><select id="project" aria-label="工作区"><option ${state.project === 'customer-web' ? 'selected' : ''}>customer-web</option><option ${state.project === 'desktop-client' ? 'selected' : ''}>desktop-client</option><option ${state.project === 'auth-service' ? 'selected' : ''}>auth-service</option></select></div>` : ''}
      <div id="mentions" class="option-card hidden"><button data-action="agent-codex">@Codex</button><button data-action="agent-claude">@Claude Code</button><button data-action="agent-opencode">@OpenCode</button></div>`;
  }

  function promptQueue() {
    if (!state.pendingPrompts.length) return '';
    const message = state.isDeciding
      ? '当前输入处理中。下面的 Prompt 暂存在界面，尚未交给 Rover。'
      : state.queueDeferred
        ? '已暂停继续处理。需要时再确认下一条。'
        : '本轮已结束。是否继续处理下一条？';
    return `<section class="prompt-queue" aria-label="待处理 Prompt"><div class="prompt-queue-head"><strong>待处理 Prompt</strong><span>${state.pendingPrompts.length} 条</span></div><p>${message}</p><ol>${state.pendingPrompts.map((entry, index) => `<li><span>${index + 1}. ${esc(entry.text)}</span><button data-queue-remove="${entry.id}" aria-label="移除待处理 Prompt ${index + 1}">×</button></li>`).join('')}</ol>${!state.isDeciding ? `<div class="prompt-queue-actions"><button class="queue-continue" data-action="queue-next">继续下一条</button><button data-action="queue-defer">暂不处理</button></div>${state.pendingClarification ? `<button class="queue-reply" data-action="queue-reply-mode">${state.queueReplyMode ? '✓ 下一条作为刚才问题的回答' : '下一条按新问题处理 · 改为回答刚才的问题'}</button>` : ''}` : ''}</section>`;
  }

  const back = label => `<div class="backline"><button data-action="back">‹ ${label || '返回任务'}</button><span>Rover · 产品交互演示</span></div>`;

  function home() {
    const processing = state.tasks.filter(item => !['completed', 'failed', 'cancelled'].includes(item.status)).sort((a, b) => Number(b.status === 'needs_attention') - Number(a.status === 'needs_attention'));
    const finished = state.tasks.filter(item => ['completed', 'failed', 'cancelled'].includes(item.status));
    return `${composer()}${promptQueue()}<div class="task-list-label">任务列表 <span>${state.tasks.length}</span></div><div class="list task-list">${[...processing, ...finished].map(taskCard).join('') || '<div class="surface"><p>目前没有任务</p></div>'}</div>`;
  }

  function compact() {
    const count = attentionCount();
    return `<div class="compact-controls"><button data-action="compose" aria-label="问 Rover 或交办任务">${icons.compose}</button><button data-action="voice" aria-label="语音输入">${icons.voice}</button><button data-action="inbox" aria-label="通知">${icons.bell}${count ? `<em>${count}</em>` : ''}</button></div>`;
  }

  function compose() {
    return `${back('返回')} ${composer()}<div class="surface" style="margin-top:13px"><div class="overline">一条输入，先由 Rover 判断如何完成</div><h2>直接回答或创建 Task</h2><p>轻量问题由 Rover 在宠物气泡回答；需要持续执行的目标进入任务列表。用 /scheduled-task 引用 Skill，或用 @Claude Code、@Codex 指定执行者。</p><div class="actions">${button('演示直接回答', 'demo-answer', 'primary')}${button('演示补充问题', 'demo-clarify')}${button('演示普通派发', 'demo-general')}${button('演示 /Skill', 'demo-slash')}</div></div>`;
  }

  function dashboard() {
    return `<div class="surface"><div class="overline">管理工作区</div><h1>Rover Dashboard</h1><p>在这里管理 Skill、定时计划和本地经验。桌面宠物继续显示当前气泡与任务列表。</p></div>
      <div class="dashboard-grid"><button data-action="skills"><strong>Skill 目录</strong><span>查看内置、项目和用户 Skill</span></button><button data-action="schedules"><strong>定时计划</strong><span>查看计划与触发记录</span></button><button data-action="memory"><strong>经验与草稿</strong><span>审阅 Episode 和 Skill 草稿</span></button><button data-action="inbox"><strong>需关注事项</strong><span>查看等待确认与失败的任务</span></button></div>`;
  }

  function voice() {
    return `${back('返回')}<div class="surface" style="text-align:center"><div class="voice-wave"><span></span><span></span><span></span><span></span><span></span></div><h1>${state.voiceText ? '语音已转写' : '听你说'}</h1><p>${esc(state.voiceText || '点击按钮模拟一句任务输入。')}</p><div class="actions" style="justify-content:center">${button('模拟语音', 'simulate-voice', 'primary')}${state.voiceText ? button('编辑后派发', 'review-voice') : ''}</div></div>`;
  }

  function inbox() {
    const urgent = state.tasks.filter(item => item.status === 'needs_attention');
    const failed = state.tasks.filter(item => item.status === 'failed');
    return `${back('返回')}<div class="surface"><h1>需要你处理</h1><p>点击任务或卡片上的会话入口，查看原 Agent Session 或不可用说明。</p></div><div class="list task-list">${[...urgent, ...failed].map(taskCard).join('') || '<div class="surface"><p>当前没有需要处理的任务。</p></div>'}</div>`;
  }

  function taskView() {
    const item = current();
    const [label, tone] = status(item.status);
    const sessionSkills = [item.skill, 'pet-task-state'].filter(Boolean);
    return `${back('返回列表')}<div class="surface"><div class="title-row"><h1>${esc(item.title)}</h1><span class="status ${tone}">${label}</span></div>
      <p>${esc(item.id)} · ${esc(item.source)} · ${esc(item.project)}</p>
      ${['completed', 'failed', 'cancelled'].includes(item.status) ? `<div class="result-panel task-markdown">${renderMarkdown(item.resultMd || item.result || item.summary)}</div>` : `<p class="task-progress">${esc(item.summary)}</p>`}
      <div class="fine-line"></div><div class="overline">派发与 Skill</div><div class="info-grid"><div>入口<strong>${esc(({ auto_skill: 'Rover 自动判断', auto_dispatch: '普通任务派发', followup_task: `接续 ${item.sourceTaskId}`, slash_skill: '/Skill 显式引用', slash_skill_at_agent: '/Skill + @Agent', at_agent: '@Agent 直接派发' })[item.routeMode] || '历史任务')}</strong></div><div>执行者<strong>${esc(item.agent)}</strong></div><div>业务 Skill<strong>${esc(item.skill || '未选用')}</strong></div><div>Rover 派发 Skill<strong>agent-dispatch</strong></div></div>
      <div class="meta-row"><span>Session ${esc(item.session)}</span>${sessionSkills.map(name => `<span>Code Agent · ${esc(name)}/SKILL.md</span>`).join('')}</div>
      <div class="actions">${item.sessionAvailable === false ? '<span class="status warn">会话不可用</span>' : button('查看会话', 'session', 'primary')}${item.status === 'completed' ? button('查看经验与 Skill 草稿', 'memory') : ''}</div></div>
      <div class="surface"><div class="overline">Task 记录</div><div class="event-list">${item.events.map(event => `<div class="event"><b>${esc(event)}</b></div>`).join('')}</div></div>`;
  }

  function session() {
    const item = current();
    if (item.sessionAvailable === false) {
      return `${back('返回任务列表')}<div class="surface"><div class="overline">会话不可用</div><h1>无法打开原 Agent Session</h1><p>${esc(item.agent)} 的 ${esc(item.session)} 当前不可访问。Rover 已保留该 Task 的失败结果和事件记录。</p><div class="actions">${button('查看 Task 记录', 'task')}</div></div>`;
    }
    const controls = item.status === 'running'
      ? `${button('模拟进度更新', 'advance-progress')}${button('模拟可恢复 API 错误', 'recoverable-error')}${button('模拟 API 错误后停止', 'fail-task')}${button('模拟 Agent 请求用户', 'request-attention')}${button('模拟 Agent 完成', 'finish-task', 'primary')}`
      : item.status === 'needs_attention'
        ? `${button('模拟在 Agent 中完成确认', 'session-resolve', 'primary')}${button('模拟在 Agent 中取消', 'session-cancel', 'danger')}`
        : item.status === 'failed'
          ? `${button('模拟 Agent 在原会话继续', 'resume-session', 'primary')}${button('模拟原会话不可用', 'unavailable-session')}` : '';
    return `${back('返回任务列表')}<div class="surface"><div class="handoff-title">会话跳转占位 · ${esc(item.agent)}</div><h1>已定位到原 Agent Session</h1><p>真实产品在 ${esc(item.agent)} 中打开 ${esc(item.session)}。Rover 只保留跳转入口与任务摘要，不展示会话内容。</p><div class="conversation-meta"><span>${esc(item.id)}</span><span>${esc(item.session)}</span></div></div>
      <div class="surface"><div class="overline">原型事件控制</div><p>下列按钮只模拟 Code Agent 的状态回报和用户在原会话中的操作。</p><div class="actions">${controls}${button('查看 Task 记录', 'task')}</div></div>`;
  }

  function schedules() {
    return `${back('返回')}<div class="surface"><h1>定时计划</h1><p>计划由 Agent 根据用户要求创建并验证。触发时，Rover 为这次执行建立新的 Task。</p></div>${state.schedules.map((entry, index) => `<div class="surface"><div class="title-row"><h2>${esc(entry.title)}</h2><span class="status green">${esc(entry.rule)}</span></div><p>创建来源：${esc(entry.sourceTask)}</p><div class="actions">${button(index === 0 ? '模拟到时触发' : '模拟触发', `trigger-schedule-${index}`, 'primary')}</div></div>`).join('')}`;
  }

  function skills() {
    const registry = [
      ['agent-dispatch', '内置 · Rover Agent', '指导 Rover Agent 启动本地 Code Agent Session，并注册一对一 Task。'],
      ['pet-task-state', '内置 · Code Agent', '指导 Code Agent 报告 Session 进度、用户介入与结果，供 Task 展示。'],
      ['current-time', '业务 · Rover Agent', '由 Rover Agent 读取本地时间并直接回答；不创建 Session 或 Task。'],
      ['scheduled-task', '业务 · 派发', '本原型配置为启动 Code Agent Session，由对应 Task 展示状态。'],
      ['deploy-to-qa', '业务', '处理 QA 发布目标；需要用户决定时在 Session 发起请求。'],
      ['incident-investigation', '业务', '排查告警与故障，保留原因和证据。']
    ];
    if (state.skillDraft.status === 'saved') registry.push([state.skillDraft.name, '用户', '从已完成任务提炼，经用户审阅后启用。']);
    return `${back('返回')}<div class="surface"><h1>可用 Skill 目录</h1><p>Skill 可供 Rover Agent 或 Code Agent 使用；是否启动 Code Agent Session、进而出现 Task，由 Skill 的流程决定。这里仅展示产品示意，不安装文件。</p></div>${registry.map(([name, scope, description]) => `<div class="surface"><div class="title-row"><h2>${esc(name)}</h2><span class="status ${scope.startsWith('内置') ? 'green' : ''}">${scope}</span></div><p>${esc(description)}</p><span class="code-chip">${esc(name)}/SKILL.md<br>references/ · scripts/ · assets/（按需）</span></div>`).join('')}${state.skillDraft.status === 'draft' ? `<div class="surface"><h2>待审阅：${esc(state.skillDraft.name)}</h2><p>草稿尚未加入可用目录。</p><div class="actions">${button('查看 Skill 草稿', 'skill-draft', 'primary')}</div></div>` : ''}`;
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
    const urgent = attentionCount();
    const speech = state.speech;
    const speechLabels = { thinking: '正在判断', answer: 'Rover 回答', clarify: '需要补充', 'followup-choice': '选择来源任务', dispatched: '已派发', unavailable: '暂时无法处理', attention: '需要你确认', warning: '任务异常', completed: '任务已完成', failed: '任务未完成', cancelled: '任务已取消' };
    const speechAction = speech?.taskId
      ? `<button class="speech-link" data-action="${['attention', 'warning'].includes(speech.status) ? 'speech-session' : 'speech-task'}">${speech.status === 'attention' ? '去确认' : speech.status === 'warning' ? '查看会话' : '查看任务'} ↗</button>`
      : '';
    $('#petArea').classList.toggle('speech-right', Boolean(state.petAnchor && state.petAnchor.x < 390));
    $('#petArea').innerHTML = `<img class="pet" src="./assets/rover-pet.png" alt="Rover 桌面宠物，拖动可移动，点击可收起或展开" draggable="false" data-action="pet">${urgent ? `<span class="pet-attention">${urgent}</span>` : ''}${speech ? `<div class="pet-speech speech-${esc(speech.status)}" role="status" aria-live="${speech.status === 'attention' ? 'assertive' : 'polite'}"><div class="speech-head"><span class="speech-status">${speech.status === 'thinking' ? '<i class="speech-spinner"></i>' : '<i class="speech-dot"></i>'}${esc(speechLabels[speech.status] || 'Rover')}</span><button class="speech-close" data-action="dismiss-speech" aria-label="关闭气泡">×</button></div><p>${esc(speech.message)}</p>${speechAction}</div>` : ''}`;
    $('#sceneMenu').classList.toggle('hidden', !state.menu);
    $('#sceneMenu').innerHTML = scenarios.map(([id, label]) => `<button class="${state.view === id ? 'selected' : ''}" data-view="${id}">${label}</button>`).join('');
    $('#toastMount').innerHTML = state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : '';
  }

  function render() {
    renderChrome();
    $('#main').innerHTML = state.petMode === 'compact' ? compact() : home();
    const managementViews = new Set(['dashboard', 'skills', 'schedules', 'memory', 'skill-draft', 'inbox']);
    const panelContent = ({ dashboard, voice, inbox, task: taskView, session,
      schedules, skills, memory, 'skill-draft': skillDraft })[state.view]?.();
    const panelTitle = managementViews.has(state.view) ? 'Rover Dashboard' : state.view === 'session' ? 'Agent Session' : state.view === 'task' ? 'Task 详情' : 'Rover 输入';
    const nav = managementViews.has(state.view)
      ? `<nav class="dashboard-nav" aria-label="管理面板导航">${[['dashboard', '概览'], ['skills', 'Skill 目录'], ['schedules', '定时计划'], ['memory', '经验与草稿'], ['inbox', '需关注']].map(([id, label]) => `<button class="${state.view === id ? 'active' : ''}" data-action="${id}">${label}</button>`).join('')}</nav>` : '';
    $('#panelMount').innerHTML = panelContent ? `<section class="rover-panel ${managementViews.has(state.view) ? 'management-panel' : 'work-panel'}" role="dialog" aria-label="${panelTitle}"><header class="panel-header"><div><span>ROVER</span><strong>${panelTitle}</strong></div><button data-action="close-panel" aria-label="关闭窗口">×</button></header>${nav}<div class="panel-body">${panelContent}</div></section>` : '';
    applyPetPosition();
    layout();
  }

  function applyPetPosition() {
    const shell = $('#roverShell');
    $('#petArea').classList.toggle('speech-right', Boolean(state.petAnchor && state.petAnchor.x < 390));
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
        const panel = $('#panelMount .rover-panel');
        if (panel) {
          viewport.scrollLeft = clamp(panel.offsetLeft + panel.offsetWidth / 2 - width / 2, 0, 1920 - width);
          viewport.scrollTop = clamp(panel.offsetTop + panel.offsetHeight / 2 - height / 2, 0, 1080 - height);
        } else if (state.petAnchor) {
          const shell = $('#roverShell');
          viewport.scrollLeft = clamp(shell.offsetLeft + shell.offsetWidth / 2 - width / 2, 0, 1920 - width);
          viewport.scrollTop = clamp(shell.offsetTop + shell.offsetHeight / 2 - height / 2, 0, 1080 - height);
        } else {
          viewport.scrollLeft = 1920 - width;
          viewport.scrollTop = 1080 - height;
        }
      });
      $('#scaleLabel').textContent = 'Rover 局部 100% · 可滚动查看桌面';
    }
    $('#fitButton').classList.toggle('active', zoomMode === 'fit');
    $('#focusButton').classList.toggle('active', zoomMode === 'focus');
  }

  function showScenario(id) {
    if (id === 'answer-demo') { submitPrompt('Rover 能做什么'); return; }
    if (id === 'queue-demo') { submitPrompt('Rover 能做什么'); submitPrompt('/current-time 现在几点'); submitPrompt('帮我整理这份需求文档'); return; }
    if (id === 'clarify-queue-demo') { submitPrompt('帮我'); submitPrompt('整理这份需求文档'); return; }
    if (id === 'rover-skill-demo') { submitPrompt('/current-time 现在几点'); return; }
    if (id === 'clarify-demo') { submitPrompt('帮我'); return; }
    if (id === 'weather-demo') { submitPrompt('今天天气怎么样'); return; }
    if (id === 'general-demo') { submitPrompt('帮我整理这份需求文档'); return; }
    if (id === 'followup-demo') { submitPrompt('给刚才那个再加测试'); return; }
    if (id === 'scheduled-demo') { submitPrompt('帮我设置一个定时任务'); return; }
    if (id === 'slash-demo') { submitPrompt('/scheduled-task 每天 09:30 检查支付链路告警'); return; }
    if (id === 'release-demo' || id === 'attention') { state.selected = 'TASK-219'; go('home'); speak('attention', 'Claude Code 正在等你确认 QA 发布。', 'TASK-219'); return; }
    if (id === 'incident-demo') { state.selected = 'INC-482'; go('home'); return; }
    if (id === 'resume-demo') { state.selected = 'TASK-215'; go('home'); speak('failed', 'OpenCode 已停止处理，请查看任务结果和原会话。', 'TASK-215'); return; }
    if (id === 'session') state.selected = 'TASK-219';
    go(id);
  }

  function handleAction(action) {
    const item = current();
    if (action.startsWith('trigger-schedule-')) {
      const entry = state.schedules[Number(action.split('-').at(-1))];
      if (entry) {
        const created = createTask(`检查${entry.title}`);
        created.source = `定时触发 · ${entry.sourceTask}`;
        created.events.unshift(`计划 ${entry.rule} 已触发`);
        speak('dispatched', `定时计划已触发，${created.agent} 正在处理。`, created.id);
      }
      return;
    }
    switch (action) {
      case 'zoom-fit': zoomMode = 'fit'; layout(); break;
      case 'zoom-focus': zoomMode = 'focus'; layout(); break;
      case 'reset-position': state.petAnchor = null; try { localStorage.removeItem(positionKey); } catch {} render(); break;
      case 'scene-menu': state.menu = !state.menu; render(); break;
      case 'dashboard': go('dashboard'); break;
      case 'close-panel': state.view = state.petMode; render(); break;
      case 'dismiss-speech': clearTimeout(speechTimer); speechRevision++; if (state.speech?.status === 'followup-choice') state.pendingFollowup = null; state.speech = null; render(); break;
      case 'speech-task': if (state.speech?.taskId) { state.selected = state.speech.taskId; go('task'); } break;
      case 'speech-session': if (state.speech?.taskId) { state.selected = state.speech.taskId; go('session'); } break;
      case 'pet': if (Date.now() - lastDragAt > 350) { state.petMode = state.petMode === 'compact' ? 'home' : 'compact'; if (['home', 'compact'].includes(state.view)) state.view = state.petMode; render(); } break;
      case 'back': go(state.view === 'skill-draft' ? 'memory' : ['skills', 'schedules', 'memory', 'inbox'].includes(state.view) ? 'dashboard' : 'home'); break;
      case 'compose': case 'voice': case 'inbox': case 'home': case 'task': case 'session': case 'schedules': case 'skills': case 'memory': case 'skill-draft': go(action); break;
      case 'completed-list': state.selected = state.tasks.find(entry => entry.status === 'completed')?.id || state.selected; go('home'); break;
      case 'plus': state.plus = !state.plus; render(); $('#prompt')?.focus(); break;
      case 'send': submitPrompt(); break;
      case 'queue-next': continueQueuedPrompt(); break;
      case 'queue-defer': state.queueDeferred = true; render(); break;
      case 'queue-reply-mode': state.queueReplyMode = !state.queueReplyMode; render(); break;
      case 'toggle-reply-mode': state.replyMode = !state.replyMode; render(); $('#prompt')?.focus(); break;
      case 'demo-answer': submitPrompt('Rover 能做什么'); break;
      case 'demo-clarify': submitPrompt('帮我'); break;
      case 'demo-general': submitPrompt('帮我整理这份需求文档'); break;
      case 'demo-scheduled': submitPrompt('帮我设置一个定时任务'); break;
      case 'demo-slash': submitPrompt('/scheduled-task 每天 09:30 检查支付链路告警'); break;
      case 'agent-codex': case 'agent-claude': case 'agent-opencode': {
        const agent = action === 'agent-codex' ? 'Codex' : action === 'agent-claude' ? 'Claude Code' : 'OpenCode';
        state.agent = agent;
        state.draft = `@${agent} ${state.draft.replace(/^@(Codex|Claude Code|OpenCode)\s*/i, '')}`;
        state.plus = false;
        render(); $('#prompt')?.focus(); break;
      }
      case 'request-attention': requestAttention(item); break;
      case 'advance-progress': advanceProgress(item); break;
      case 'recoverable-error': showRecoverableError(item); break;
      case 'fail-task': failTask(item); break;
      case 'session-resolve': resolveAttention(item, item.kind === 'scheduled' ? '每天 09:30 检查支付链路告警' : '已在原 Session 确认'); break;
      case 'session-cancel': resolveAttention(item, '', true); break;
      case 'finish-task': finishTask(item); break;
      case 'resume-session': resumeInSession(item); break;
      case 'unavailable-session': markSessionUnavailable(item); break;
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
    const followupSource = event.target.closest('[data-followup-source]');
    if (followupSource && state.pendingFollowup) { createFollowupTask(task(followupSource.dataset.followupSource), state.pendingFollowup.instruction); return; }
    const queueRemove = event.target.closest('[data-queue-remove]');
    if (queueRemove) {
      state.pendingPrompts = state.pendingPrompts.filter(entry => entry.id !== Number(queueRemove.dataset.queueRemove));
      if (!state.pendingPrompts.length) { state.queueDeferred = false; state.queueReplyMode = false; }
      render();
      return;
    }
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
  document.addEventListener('pointerenter', event => {
    if (event.target?.classList?.contains('pet-speech')) clearTimeout(speechTimer);
  }, true);
  document.addEventListener('pointerleave', event => {
    if (event.target?.classList?.contains('pet-speech')) scheduleSpeechDismiss();
  }, true);
  document.addEventListener('change', event => {
    if (event.target.id === 'project') state.project = event.target.value;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { state.menu = false; if (!['home', 'compact'].includes(state.view)) { state.view = state.petMode; render(); } else if (state.petMode !== 'compact') go('compact'); else render(); }
    if (event.key === 'Enter' && event.target.id === 'prompt') { event.preventDefault(); submitPrompt(); }
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
