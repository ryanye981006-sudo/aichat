-- 迁移 012: 会话隐私模式字段
-- 对应产品方案 §用户交互 — 会话级临时开关

ALTER TABLE conversations ADD COLUMN privacy_mode INTEGER NOT NULL DEFAULT 0;
