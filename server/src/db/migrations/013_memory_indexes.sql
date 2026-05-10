-- 迁移 013: 索引优化

CREATE INDEX idx_messages_turn ON messages(conversation_id, turn_index);
CREATE INDEX idx_memories_status ON memories(status);
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed);
