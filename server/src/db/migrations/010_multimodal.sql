-- 010_multimodal.sql: 多模态 embedding 升级

-- 分块增加类型字段（text / image）
ALTER TABLE knowledge_chunks ADD COLUMN chunk_type TEXT NOT NULL DEFAULT 'text';

-- 图片块存储图片文件路径
ALTER TABLE knowledge_chunks ADD COLUMN image_path TEXT;
