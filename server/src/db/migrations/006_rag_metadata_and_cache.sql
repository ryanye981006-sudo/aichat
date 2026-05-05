-- 006_rag_metadata_and_cache.sql: RAG 元数据增强 + 嵌入缓存

-- 知识库新增分块策略、查询改写、重排序等配置字段
ALTER TABLE knowledge_bases ADD COLUMN chunk_strategy TEXT NOT NULL DEFAULT 'recursive';
ALTER TABLE knowledge_bases ADD COLUMN enable_query_rewrite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_bases ADD COLUMN enable_rerank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_bases ADD COLUMN rerank_provider_id TEXT;
ALTER TABLE knowledge_bases ADD COLUMN rerank_model_id TEXT;

-- 文档新增处理配置快照（记录处理时的分段参数、向量模型等）
ALTER TABLE knowledge_documents ADD COLUMN processing_config TEXT;

-- 分块新增元数据（记录生成该分块使用的嵌入模型、供应商、维度等）
ALTER TABLE knowledge_chunks ADD COLUMN metadata TEXT;

-- 分块新增知识库 ID 冗余字段，方便直接按知识库查询分块
ALTER TABLE knowledge_chunks ADD COLUMN knowledge_base_id TEXT REFERENCES knowledge_bases(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kb ON knowledge_chunks(knowledge_base_id);

-- 嵌入缓存表
CREATE TABLE IF NOT EXISTS embedding_cache (
  cache_key TEXT PRIMARY KEY,
  embedding TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_emb_cache_accessed ON embedding_cache(accessed_at);
CREATE INDEX IF NOT EXISTS idx_emb_cache_provider_model ON embedding_cache(provider_id, model_name);
