-- 在 messages 表中记录请求时使用的模型名称
-- 解决修改助手模型后历史消息显示的模型名跟着变化的问题
ALTER TABLE messages ADD COLUMN model_name TEXT;
