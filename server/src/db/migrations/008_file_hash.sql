-- 文件哈希去重
ALTER TABLE knowledge_documents ADD COLUMN file_hash TEXT DEFAULT NULL;
