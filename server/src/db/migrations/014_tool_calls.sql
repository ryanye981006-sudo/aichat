-- 工具调用持久化 + 联网搜索开关
ALTER TABLE messages ADD COLUMN tool_calls TEXT;
ALTER TABLE assistants ADD COLUMN enable_web_search INTEGER NOT NULL DEFAULT 0;
