import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// 获取对话列表（按助手筛选）
router.get('/', (req, res) => {
  const db = getDb();
  const { assistantId } = req.query;
  let conversations;
  if (assistantId) {
    conversations = db.prepare(
      'SELECT * FROM conversations WHERE assistant_id = ? ORDER BY updated_at DESC'
    ).all(assistantId);
  } else {
    conversations = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all();
  }
  res.json(conversations);
});

// 创建对话
router.post('/', (req, res) => {
  const db = getDb();
  const { assistant_id, title } = req.body;
  if (!assistant_id) {
    return res.status(400).json({ error: 'assistant_id 不能为空' });
  }

  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(assistant_id);
  if (!assistant) {
    return res.status(404).json({ error: '助手不存在' });
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO conversations (id, assistant_id, title) VALUES (?, ?, ?)'
  ).run(id, assistant_id, title || '新话题');

  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.status(201).json(conversation);
});

// 更新对话标题
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '对话不存在' });
  }

  const { title, privacy_mode } = req.body;
  if (title !== undefined) {
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title, req.params.id);
  }
  if (privacy_mode !== undefined) {
    db.prepare(
      "UPDATE conversations SET privacy_mode = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(privacy_mode ? 1 : 0, req.params.id);
  }

  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  res.json(conversation);
});

// 删除对话
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '对话不存在' });
  }
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
