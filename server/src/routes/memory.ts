import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { memoryService } from '../services/MemoryService.js';

const router = Router();

// 获取记忆设置
router.get('/settings', (_req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get();
  res.json(settings || { enabled: 0 });
});

// 更新记忆设置
router.put('/settings', (req, res) => {
  const db = getDb();
  const fields = ['enabled', 'llm_provider_id', 'llm_model_id', 'embedding_provider_id', 'embedding_model_id', 'embedding_dimension'];
  const updates: string[] = [];
  const values: any[] = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(field === 'enabled' ? (req.body[field] ? 1 : 0) : req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    db.prepare(`UPDATE memory_settings SET ${updates.join(', ')} WHERE id = 1`).run(...values);
  }

  const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get();
  res.json(settings);
});

// 获取记忆列表
router.get('/', (req, res) => {
  const db = getDb();
  const { search } = req.query;
  let memories;
  if (search && typeof search === 'string') {
    memories = db.prepare(
      "SELECT id, content, hash, is_deleted, created_at, updated_at FROM memories WHERE is_deleted = 0 AND content LIKE ? ORDER BY updated_at DESC LIMIT 100"
    ).all(`%${search}%`);
  } else {
    memories = db.prepare(
      'SELECT id, content, hash, is_deleted, created_at, updated_at FROM memories WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT 100'
    ).all();
  }
  res.json(memories);
});

// 向量搜索记忆
router.post('/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query 不能为空' });
    }
    const results = await memoryService.search(query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 获取记忆变更历史
router.get('/history', (req, res) => {
  const db = getDb();
  const { memoryId } = req.query;
  let rows;
  if (memoryId && typeof memoryId === 'string') {
    rows = db.prepare(
      'SELECT * FROM memory_history WHERE memory_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(memoryId);
  } else {
    rows = db.prepare(
      'SELECT * FROM memory_history ORDER BY created_at DESC LIMIT 100'
    ).all();
  }
  res.json(rows);
});

// 手动创建记忆
router.post('/', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content 不能为空' });
    }
    await (memoryService as any).addMemory(content);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
