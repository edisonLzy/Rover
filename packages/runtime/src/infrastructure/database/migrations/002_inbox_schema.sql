-- 002_inbox_schema.sql
-- M3 Inbox Storage Schema
-- Matches ADR-0005, ADR-0018, TRD Section 8, and M3 Ticket 001 specifications

-- 1. Inbox 事件日志与幂等消重表
CREATE TABLE IF NOT EXISTS inbox_event (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  UNIQUE(source_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_event_source ON inbox_event(source_id, source_event_id);

-- 2. Inbox 业务消息投影表
CREATE TABLE IF NOT EXISTS inbox_message (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ('unread', 'read', 'delegated', 'resolved')),
  task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  UNIQUE(source_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_message_source ON inbox_message(source_id, source_message_id);
CREATE INDEX IF NOT EXISTS idx_inbox_message_status ON inbox_message(status);
CREATE INDEX IF NOT EXISTS idx_inbox_message_occurred_at ON inbox_message(occurred_at DESC);
