// 知识库路由：文档上传/列表/删除 + 搜索测试
import { Router, Request, Response } from 'express';
import { knowledgeService } from '../services/KnowledgeService.js';
import { upload, fixFileNameEncoding } from '../services/FileStorage.js';

const router = Router();

// POST /api/knowledge/documents — 上传文档（支持多文件）
router.post('/documents', upload.array('files', 10), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: '请选择文件' });
    return;
  }

  const results: { docId: string; fileName: string; error?: string }[] = [];

  for (const file of files) {
    const originalName = fixFileNameEncoding(file.originalname);
    try {
      const docId = knowledgeService.addDocument(file.filename, originalName, 'file');
      // 异步处理，不阻塞响应
      knowledgeService.processDocument(docId).catch(err => {
        console.error(`[知识库] 文档处理失败:`, err);
      });
      results.push({ docId, fileName: originalName });
    } catch (err: any) {
      results.push({ docId: '', fileName: originalName, error: err.message });
    }
  }

  res.json({ success: true, results });
});

// GET /api/knowledge/documents — 文档列表
router.get('/documents', (_req: Request, res: Response) => {
  const docs = knowledgeService.listDocuments();
  res.json(docs);
});

// DELETE /api/knowledge/documents/:id — 删除文档
router.delete('/documents/:id', (req: Request, res: Response) => {
  try {
    knowledgeService.deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// POST /api/knowledge/search — 搜索测试
router.post('/search', async (req: Request, res: Response) => {
  const { query, topK } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query 不能为空' });
    return;
  }
  try {
    const results = await knowledgeService.searchKnowledge(query, topK || 5);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
