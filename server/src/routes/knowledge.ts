import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { knowledgeService } from '../services/KnowledgeService.js';
import { processingQueue } from '../services/ProcessingQueue.js';
import { upload, fixFileNameEncoding } from '../services/FileStorage.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// KB 创建/更新时支持的字段
const KB_FIELDS = [
  'name', 'embedding_provider_id', 'embedding_model_id',
  'chunk_size', 'chunk_overlap', 'search_top_k', 'similarity_threshold',
  'chunk_strategy', 'enable_query_rewrite', 'enable_rerank',
  'rerank_provider_id', 'rerank_model_id',
];

// 获取所有知识库（含文档计数）
router.get('/', (_req, res) => {
  const db = getDb();
  const kbs = db.prepare(
    `SELECT kb.*, COALESCE(doc_stats.doc_count, 0) AS document_count
     FROM knowledge_bases kb
     LEFT JOIN (
       SELECT knowledge_base_id, COUNT(*) AS doc_count
       FROM knowledge_documents
       WHERE processing_status = 'completed'
       GROUP BY knowledge_base_id
     ) doc_stats ON doc_stats.knowledge_base_id = kb.id
     ORDER BY kb.created_at DESC`
  ).all();
  res.json(kbs);
});

// 创建知识库
router.post('/', (req, res) => {
  const db = getDb();
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: '名称不能为空' });
  }

  const id = uuidv4();
  const fields: string[] = ['id'];
  const placeholders: string[] = ['?'];
  const values: any[] = [id];

  const defaults: Record<string, any> = {
    name: '',
    embedding_provider_id: null,
    embedding_model_id: null,
    chunk_size: 512,
    chunk_overlap: 50,
    search_top_k: 5,
    similarity_threshold: 0.7,
    chunk_strategy: 'recursive',
    enable_query_rewrite: 0,
    enable_rerank: 0,
    rerank_provider_id: null,
    rerank_model_id: null,
  };

  for (const key of KB_FIELDS) {
    fields.push(key);
    placeholders.push('?');
    values.push(req.body[key] !== undefined ? req.body[key] : defaults[key]);
  }

  db.prepare(
    `INSERT INTO knowledge_bases (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`
  ).run(...values);

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

  const updates: string[] = [];
  const values: any[] = [];

  for (const field of KB_FIELDS) {
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
    `SELECT kd.*, COALESCE(SUM(kc.recall_count), 0) AS recall_count
     FROM knowledge_documents kd
     LEFT JOIN knowledge_chunks kc ON kc.document_id = kd.id
     WHERE kd.knowledge_base_id = ?
     GROUP BY kd.id
     ORDER BY kd.created_at DESC`
  ).all(req.params.id);
  res.json(docs);
});

// 上传文档（使用并发队列，含文件哈希去重）
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

    // 计算文件哈希
    const filePath = path.join(config.uploadsDir, req.file.filename);
    const fileBuffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 检查同一知识库下是否已存在相同哈希的文件
    const existing = db.prepare(
      'SELECT * FROM knowledge_documents WHERE knowledge_base_id = ? AND file_hash = ?'
    ).get(req.params.id, fileHash) as any;

    if (existing) {
      // 删除刚上传的重复文件
      try { fs.unlinkSync(filePath); } catch { /* 忽略 */ }
      return res.status(409).json({ error: `文件已存在：${existing.file_name}` });
    }

    const docId = uuidv4();
    const originalName = fixFileNameEncoding(req.file.originalname);
    db.prepare(
      'INSERT INTO knowledge_documents (id, knowledge_base_id, source_type, file_path, file_name, file_hash) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(docId, req.params.id, 'file', req.file.filename, originalName, fileHash);

    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(docId);

    // 使用队列异步处理文档
    processingQueue.enqueue(docId).catch(err => {
      console.error(`[KnowledgeRoute] 文档处理失败 (${docId}):`, err);
    });

    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 删除文档及其分块和上传文件
router.delete('/:id/documents/:docId', (req, res) => {
  try {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ? AND knowledge_base_id = ?')
      .get(req.params.docId, req.params.id) as any;
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }

    // 取消正在进行的异步处理（队列等待的移除，运行中的后续步骤会跳过）
    processingQueue.cancel(req.params.docId);

    // 删除上传文件
    if (doc.file_path) {
      try {
        const filePath = path.join(config.uploadsDir, doc.file_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.warn('[KnowledgeRoute] 删除文件失败:', err);
      }
    }

    // 删除分块和文档记录
    db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(doc.id);
    db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(doc.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 获取文档的分块（含元数据，不含向量）
router.get('/:id/documents/:docId/chunks', (req, res) => {
  const db = getDb();
  const chunks = db.prepare(
    'SELECT * FROM knowledge_chunks WHERE document_id = ? ORDER BY chunk_index ASC'
  ).all(req.params.docId);
  res.json((chunks as any[]).map(c => ({
    id: c.id,
    document_id: c.document_id,
    knowledge_base_id: c.knowledge_base_id,
    chunk_index: c.chunk_index,
    content: c.content,
    metadata: c.metadata ? JSON.parse(c.metadata) : null,
    recall_count: c.recall_count || 0,
    created_at: c.created_at,
  })));
});

// RAG 搜索（按嵌入配置分组搜索）
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

// 获取上传文件（在线查看/下载）
router.get('/files/:docId', (req, res) => {
  try {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(req.params.docId) as any;
    if (!doc || !doc.file_path) {
      return res.status(404).json({ error: '文件不存在' });
    }
    const filePath = path.join(config.uploadsDir, doc.file_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 处理队列状态
router.get('/queue-status', (_req, res) => {
  res.json(processingQueue.getStatus());
});

export default router;
