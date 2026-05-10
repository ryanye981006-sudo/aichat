// 记忆管理 API：设置 + 列表 + 搜索 + CRUD 增强 + 历史

import { Router, Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { memoryService } from '../services/MemoryService.js';
import { memoryRetrievalService } from '../services/MemoryRetrievalService.js';
import { embeddingService } from '../services/EmbeddingService.js';

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
  const { search, status } = req.query;
  let sql = "SELECT id, content, topic, type, importance, status, access_count, last_accessed, created_at, updated_at FROM memories WHERE is_deleted = 0";
  const params: any[] = [];

  if (status && typeof status === 'string') {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (search && typeof search === 'string') {
    sql += ' AND content LIKE ?';
    params.push(`%${search}%`);
  }

  sql += ' ORDER BY updated_at DESC LIMIT 100';
  const memories = db.prepare(sql).all(...params);
  res.json(memories);
});

// 向量搜索记忆
router.post('/search', async (req, res) => {
  try {
    const { query, limit } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query 不能为空' });
    }
    const results = await memoryRetrievalService.searchMemory(query, limit ?? 5);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 获取记忆详情（含 source_links）
router.get('/:id', (req, res) => {
  try {
    const detail = memoryService.getMemoryDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ error: '记忆不存在' });
    }
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 获取记忆关联的来源列表
router.get('/:id/sources', (req, res) => {
  try {
    const db = getDb();
    const memory = db.prepare("SELECT id FROM memories WHERE id = ? AND is_deleted = 0").get(req.params.id) as any;
    if (!memory) {
      return res.status(404).json({ error: '记忆不存在' });
    }

    const sources = db.prepare(
      'SELECT * FROM memory_source_links WHERE memory_id = ?'
    ).all(req.params.id);

    res.json(sources);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 手动编辑记忆内容（重新 embedding）
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content 不能为空' });
    }

    const memory = db.prepare("SELECT * FROM memories WHERE id = ? AND is_deleted = 0").get(req.params.id) as any;
    if (!memory) {
      return res.status(404).json({ error: '记忆不存在' });
    }

    const hash = (await import('../utils/hash.js')).sha256(content);
    const { embedding } = await embeddingService.embed(content);
    const { importance } = memoryService.computeImportance(content);

    db.prepare(`
      UPDATE memories SET content = ?, hash = ?, embedding = ?, importance = ?, updated_at = datetime('now') WHERE id = ?
    `).run(content, hash, JSON.stringify(embedding), importance, req.params.id);

    db.prepare(
      "INSERT INTO memory_history (memory_id, action, previous_value, new_value) VALUES (?, 'UPDATE', ?, ?)"
    ).run(req.params.id, memory.content, content);

    const updated = memoryService.getMemoryDetail(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 软删除记忆
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const memory = db.prepare("SELECT * FROM memories WHERE id = ? AND is_deleted = 0").get(req.params.id) as any;
    if (!memory) {
      return res.status(404).json({ error: '记忆不存在' });
    }

    db.prepare(`
      UPDATE memories SET is_deleted = 1, status = 'invalidated', updated_at = datetime('now') WHERE id = ?
    `).run(req.params.id);

    db.prepare(
      "INSERT INTO memory_history (memory_id, action, previous_value) VALUES (?, 'DELETE', ?)"
    ).run(req.params.id, memory.content);

    res.json({ success: true });
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
