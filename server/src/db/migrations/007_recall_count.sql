-- 为分块表增加召回计数
ALTER TABLE knowledge_chunks ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_recall ON knowledge_chunks(recall_count);
