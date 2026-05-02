import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// 获取对话消息
router.get('/', (req, res) => {
  const db = getDb();
  const { conversationId } = req.query;
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId 不能为空' });
  }
  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId);
  res.json(messages);
});

export default router;
