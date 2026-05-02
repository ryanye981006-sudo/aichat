ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE messages ADD COLUMN completion_tokens INTEGER;
ALTER TABLE messages ADD COLUMN ttft_ms INTEGER;
ALTER TABLE messages ADD COLUMN tokens_per_second INTEGER;
