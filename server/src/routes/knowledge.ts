import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { knowledgeService } from '../services/KnowledgeService.js';
import { upload } from '../services/FileStorage.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// 获取所有知识库
router.get('/', (_req, res) => {
  const db = getDb();
  const kbs = db.prepare('SELECT * FROM knowledge_bases ORDER BY created_at DESC').all();
  res.json(kbs);
});

// 创建知识库
router.post('/', (req, res) => {
  const db = getDb();
  const { name, embedding_provider_id, embedding_model_id, chunk_size, chunk_overlap, search_top_k, similarity_threshold } = req.body;
  if (!name) {
    return res.status(400).json({ error: '名称不能为空' });
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO knowledge_bases (id, name, embedding_provider_id, embedding_model_id, chunk_size, chunk_overlap, search_top_k, similarity_threshold)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, name,
    embedding_provider_id || null,
    embedding_model_id || null,
    chunk_size || 512,
    chunk_overlap || 50,
    search_top_k || 5,
    similarity_threshold ?? 0.7
  );

  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(id);
  res.status(201).json(kb);
});

// 更新知识库
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '知识库不存在' });
  }

  const fields = ['name', 'embedding_provider_id', 'embedding_model_id', 'chunk_size', 'chunk_overlap', 'search_top_k', 'similarity_threshold'];
  const updates: string[] = [];
  const values: any[] = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);
    db.prepare(`UPDATE knowledge_bases SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(req.params.id);
  res.json(kb);
});

// 删除知识库
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '知识库不存在' });
  }
  db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 获取知识库文档列表
router.get('/:id/documents', (req, res) => {
  const db = getDb();
  const docs = db.prepare(
    'SELECT * FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json(docs);
});

// 上传文档
router.post('/:id/documents', upload.single('file'), async (req, res) => {
  try {
    const db = getDb();
    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(req.params.id);
    if (!kb) {
      return res.status(404).json({ error: '知识库不存在' });
    }

    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const docId = uuidv4();
    db.prepare(
      'INSERT INTO knowledge_documents (id, knowledge_base_id, source_type, file_path, file_name) VALUES (?, ?, ?, ?, ?)'
    ).run(docId, req.params.id, 'file', req.file.filename, req.file.originalname);

    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(docId);

    // 异步处理文档
    knowledgeService.processDocument(docId).catch(err => {
      console.error(`[KnowledgeRoute] 文档处理失败 (${docId}):`, err);
    });

    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 获取文档的分块
router.get('/:id/documents/:docId/chunks', (req, res) => {
  const db = getDb();
  const chunks = db.prepare(
    'SELECT * FROM knowledge_chunks WHERE document_id = ? ORDER BY chunk_index ASC'
  ).all(req.params.docId);
  res.json((chunks as any[]).map(c => ({ ...c, embedding: undefined }))); // 不返回嵌入向量
});

// RAG 搜索
router.post('/:id/search', async (req, res) => {
  try {
    const { query, topK, threshold } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query 不能为空' });
    }
    const results = await knowledgeService.search([req.params.id], query, topK, threshold);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
