import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// 获取模型列表（按提供商筛选）
router.get('/', (req, res) => {
  const db = getDb();
  const { providerId } = req.query;
  let models;
  if (providerId) {
    models = db.prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY name ASC').all(providerId);
  } else {
    models = db.prepare('SELECT * FROM models ORDER BY name ASC').all();
  }
  res.json(models);
});

// 手动添加模型
router.post('/', (req, res) => {
  const db = getDb();
  const { provider_id, name, display_name, context_length } = req.body;

  if (!provider_id || !name) {
    return res.status(400).json({ error: 'provider_id 和 name 不能为空' });
  }

  // 检查提供商是否存在
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(provider_id);
  if (!provider) {
    return res.status(404).json({ error: '提供商不存在' });
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO models (id, provider_id, name, display_name, context_length) VALUES (?, ?, ?, ?, ?)'
  ).run(id, provider_id, name, display_name || name, context_length || 8192);

  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(id);
  res.status(201).json(model);
});

// 删除模型
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '模型不存在' });
  }
  db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
