-- 001_initial_schema.sql
-- M2 Rover Core Initial Database Schema
-- Matches ADR-0014, TRD Section 6, and M2 Ticket 001 specifications

-- 1. 回合生命周期投影表 (Rover Turn)
CREATE TABLE IF NOT EXISTS rover_turn (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  prompt_doc TEXT NOT NULL CHECK (json_valid(prompt_doc)),
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- 2. 消息粒度线性 Entry 与独立 Compaction 条目 (Rover Entry)
CREATE TABLE IF NOT EXISTS rover_entry (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  turn_id TEXT REFERENCES rover_turn(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('message', 'compaction')),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at INTEGER NOT NULL,
  CHECK (
    (type = 'message' AND turn_id IS NOT NULL)
    OR (type = 'compaction' AND turn_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_rover_entry_turn_seq ON rover_entry(turn_id, seq);
CREATE INDEX IF NOT EXISTS idx_rover_entry_latest_compaction ON rover_entry(seq DESC) WHERE type = 'compaction';

-- 3. 统一实时事件序列表 (WebSocket 同步账本)
CREATE TABLE IF NOT EXISTS runtime_event (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_event_seq ON runtime_event(event_seq);

-- 4. 派发尝试记录表 (防孤儿进程底座)
CREATE TABLE IF NOT EXISTS dispatch_attempt (
  id TEXT PRIMARY KEY,
  candidate_task_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('turn', 'plan', 'inbox')),
  source_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex', 'opencode')),
  cwd TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('starting', 'registered', 'failed')),
  native_session_id TEXT,
  report_token_hash TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dispatch_attempt_source ON dispatch_attempt(source_kind, source_id);

-- 5. 任务卡片投影表 (与 Session 1:1 映射)
CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex', 'opencode')),
  status TEXT NOT NULL CHECK (status IN ('running', 'needs_intervention', 'completed', 'failed', 'unverified')),
  progress_text TEXT,
  result_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);

-- 6. 会话底层引用表 (终端接管凭证)
CREATE TABLE IF NOT EXISTS session_ref (
  task_id TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex', 'opencode')),
  native_session_id TEXT NOT NULL,
  config_dir TEXT NOT NULL,
  carrier_kind TEXT NOT NULL DEFAULT 'screen',
  carrier_name TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'unavailable')),
  last_seen INTEGER NOT NULL,
  UNIQUE(agent, native_session_id, config_dir)
);

-- 7. 任务事件去重流
CREATE TABLE IF NOT EXISTS task_event (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  summary TEXT,
  evidence_ref TEXT,
  UNIQUE(task_id, source, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_task_event_task ON task_event(task_id, observed_at);

-- 8. 可引用任务摘要 (task-recall 专用)
CREATE TABLE IF NOT EXISTS task_summary (
  task_id TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'agent_report',
  updated_at INTEGER NOT NULL
);

-- 9. 最近活动台账
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task_completed', 'task_failed', 'plan_executed')),
  ref_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_occurred_at ON activity(occurred_at DESC);

