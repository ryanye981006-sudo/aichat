import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// 获取对话消息（支持分页）
router.get('/', (req, res) => {
  const db = getDb();
  const { conversationId, limit, offset } = req.query;
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId 不能为空' });
  }
  if (limit != null || offset != null) {
    const l = Math.min(Math.max(Number(limit) || 50, 1), 200); // 限制 1-200
    const o = Math.max(Number(offset) || 0, 0);
    const messages = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
    ).all(conversationId, l, o);
    res.json(messages);
  } else {
    const messages = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId);
    res.json(messages);
  }
});

export default router;
