import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// 获取所有助手
router.get('/', (_req, res) => {
  const db = getDb();
  const assistants = db.prepare('SELECT * FROM assistants ORDER BY created_at DESC').all();
  res.json(assistants);
});

// 获取单个助手
router.get('/:id', (req, res) => {
  const db = getDb();
  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(req.params.id);
  if (!assistant) {
    return res.status(404).json({ error: '助手不存在' });
  }
  res.json(assistant);
});

// 创建助手
router.post('/', (req, res) => {
  const db = getDb();
  const {
    name, system_prompt, emoji,
    model_id, provider_id, temperature, temperature_enabled,
    context_rounds, enable_memory, knowledge_base_ids
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: '名称不能为空' });
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO assistants (id, name, system_prompt, emoji, model_id, provider_id, temperature, temperature_enabled, context_rounds, enable_memory, knowledge_base_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    name,
    system_prompt || '',
    emoji || '🤖',
    model_id || null,
    provider_id || null,
    temperature ?? 0.7,
    temperature_enabled ? 1 : 0,
    context_rounds ?? 10,
    enable_memory ? 1 : 0,
    JSON.stringify(knowledge_base_ids || [])
  );

  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(id);
  res.status(201).json(assistant);
});

// 更新助手
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM assistants WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '助手不存在' });
  }

  const fields = [
    'name', 'system_prompt', 'emoji',
    'model_id', 'provider_id', 'temperature', 'temperature_enabled',
    'context_rounds', 'enable_memory'
  ];
  const updates: string[] = [];
  const values: any[] = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'temperature_enabled' || field === 'enable_memory') {
        values.push(req.body[field] ? 1 : 0);
      } else {
        values.push(req.body[field]);
      }
    }
  }

  if (req.body.knowledge_base_ids !== undefined) {
    updates.push('knowledge_base_ids = ?');
    values.push(JSON.stringify(req.body.knowledge_base_ids));
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);
    db.prepare(`UPDATE assistants SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(req.params.id);
  res.json(assistant);
});

// 删除助手
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM assistants WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '助手不存在' });
  }
  db.prepare('DELETE FROM assistants WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
