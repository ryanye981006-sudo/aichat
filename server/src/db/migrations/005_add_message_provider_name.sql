-- 在 messages 表中记录请求时使用的供应商名称
-- 与 004 的 model_name 配合，消息气泡可以固定显示发送时的"模型名 | 供应商名"
ALTER TABLE messages ADD COLUMN provider_name TEXT;
