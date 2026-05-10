-- 迁移 011: 三层时间模型 + 双向链接 + 记忆增强
-- 对应产品方案 §记忆与消息/Chunk 的关联模型 + §记忆提取时的元数据写入

-- messages 表新增字段
ALTER TABLE messages ADD COLUMN turn_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN privacy_mode INTEGER NOT NULL DEFAULT 0;

-- 新建 conversation_chunks 表
-- status: 'open'=正在增长 | 'closed'=已闭合待提取(对应产品方案"pending") | 'extracting'=提取中 | 'extracted'=已提取
CREATE TABLE conversation_chunks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  start_turn_index INTEGER NOT NULL,
  end_turn_index INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  embedding TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','extracting','extracted')),
  closed_at TEXT,
  extracted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chunks_conv ON conversation_chunks(conversation_id);
CREATE INDEX idx_chunks_status ON conversation_chunks(conversation_id, status);

-- 新建 chunk_messages 表：chunk ↔ message 精确关联
CREATE TABLE chunk_messages (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES conversation_chunks(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cm_chunk ON chunk_messages(chunk_id);
CREATE INDEX idx_cm_message ON chunk_messages(message_id);

-- 新建 message_attachments 表：消息附件独立存储
CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('image','file','audio','video')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ma_message ON message_attachments(message_id);

-- 新建 message_web_retrievals 表：AI 网页检索结果
CREATE TABLE message_web_retrievals (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mwr_message ON message_web_retrievals(message_id);

-- memories 表新增字段
ALTER TABLE memories ADD COLUMN source_conversation_id TEXT;
ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'fact';
ALTER TABLE memories ADD COLUMN topic TEXT;
ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN metadata TEXT;
ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','invalidated'));
ALTER TABLE memories ADD COLUMN superseded_by TEXT REFERENCES memories(id);
ALTER TABLE memories ADD COLUMN valid_from TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE memories ADD COLUMN valid_until TEXT;
ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_accessed TEXT;

-- 新建 memory_source_links 表：记忆 ↔ chunk 双向链接
CREATE TABLE memory_source_links (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES conversation_chunks(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'chunk' CHECK(source_type IN ('chunk','message','attachment','web_retrieval')),
  source_id TEXT,
  relevance_score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_msl_memory ON memory_source_links(memory_id);
CREATE INDEX idx_msl_chunk ON memory_source_links(chunk_id);

-- 新建 user_profile 表：用户个人信息 KV 存储
CREATE TABLE user_profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
