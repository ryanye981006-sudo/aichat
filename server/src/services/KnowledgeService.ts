// 知识库服务：文档管理 + 语义检索
// 单一内置知识库，嵌入/重排序模型从 user_profile（工具设置）动态读取
import { getDb } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { embeddingService } from './EmbeddingService.js';
import { rerankerService } from './RerankerService.js';
import { loaderService } from './LoaderService.js';
import { chunkText, type ChunkStrategy } from '../utils/chunk.js';
import { cosineSimilarity } from '../utils/vector.js';
import { sha256 } from '../utils/hash.js';

// 搜索结果类型
export interface KnowledgeSearchResult {
  chunk_id: string;
  content: string;
  score: number;
  document_name: string;
  document_id: string;
}

// 文档列表项
export interface KnowledgeDocumentSummary {
  id: string;
  file_name: string;
  processing_status: string;
  chunk_count: number;
  error_message: string | null;
  created_at: string;
  file_hash: string;
}

// 默认知识库名称
const DEFAULT_KB_NAME = '知识库';

// 默认分块参数
const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 50;

export class KnowledgeService {
  // 确保默认知识库存在，返回其 ID
  ensureDefaultKnowledgeBase(): string {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM knowledge_bases LIMIT 1').get() as any;
    if (existing) return existing.id;

    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO knowledge_bases (id, name, chunk_size, chunk_overlap, search_top_k, similarity_threshold, chunk_strategy, enable_query_rewrite, enable_rerank, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, DEFAULT_KB_NAME, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, 5, 0.7, 'recursive', 0, 1, now, now);
    return id;
  }

  // 新增文档记录（不触发处理）
  addDocument(filePath: string, fileName: string, sourceType: 'file' = 'file'): string {
    const db = getDb();
    const kbId = this.ensureDefaultKnowledgeBase();
    const docId = uuidv4();
    const now = new Date().toISOString();

    let fileHash = '';
    try {
      // 使用文件名+大小生成 hash 以支持去重检测
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(config.uploadsDir, filePath);
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      fileHash = sha256(content);
    } catch { /* 读取失败则跳过 hash */ }

    // 检查是否已存在相同 hash 的已完成文档
    if (fileHash) {
      const dup = db.prepare(
        "SELECT id FROM knowledge_documents WHERE knowledge_base_id = ? AND file_hash = ? AND processing_status = 'completed'"
      ).get(kbId, fileHash) as any;
      if (dup) throw new Error('相同文件已存在（' + fileName + '）');
    }

    db.prepare(`
      INSERT INTO knowledge_documents (id, knowledge_base_id, source_type, file_path, file_name, file_hash, processing_status, chunk_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    `).run(docId, kbId, sourceType, filePath, fileName, fileHash, now, now);

    return docId;
  }

  // 处理文档：加载 → 分块 → 嵌入 → 存储
  async processDocument(docId: string): Promise<void> {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(docId) as any;
    if (!doc) throw new Error('文档不存在');
    if (doc.processing_status === 'completed') return;

    const kbId = doc.knowledge_base_id;
    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(kbId) as any;

    try {
      // 状态 → loading
      db.prepare("UPDATE knowledge_documents SET processing_status = 'loading', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), docId);

      // 加载文件文本（根据扩展名推断 mimeType）
      const ext = path.extname(doc.file_path).toLowerCase();
      const extMimeMap: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown' };
      const mimeType = extMimeMap[ext] || 'text/plain';
      const loadResult = await loaderService.loadFile(doc.file_path, mimeType);
      const rawText = loadResult.text;
      if (!rawText.trim()) throw new Error('文档无有效文本内容');

      // 状态 → chunking
      db.prepare("UPDATE knowledge_documents SET processing_status = 'chunking', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), docId);

      // 分块
      const strategy = (kb?.chunk_strategy || 'recursive') as ChunkStrategy;
      const chunkSize = kb?.chunk_size || DEFAULT_CHUNK_SIZE;
      const chunkOverlap = kb?.chunk_overlap || DEFAULT_CHUNK_OVERLAP;
      const chunks = chunkText(rawText, chunkSize, chunkOverlap, strategy);

      if (chunks.length === 0) throw new Error('分块结果为空');

      // 状态 → embedding
      db.prepare("UPDATE knowledge_documents SET processing_status = 'embedding', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), docId);

      // 批量嵌入
      const embResults = await embeddingService.embedBatch(chunks);
      const now = new Date().toISOString();

      // 批量写入分块
      const insertChunk = db.prepare(`
        INSERT INTO knowledge_chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, chunk_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'text', ?)
      `);

      const insertAll = db.transaction(() => {
        for (let i = 0; i < chunks.length; i++) {
          insertChunk.run(
            uuidv4(), docId, kbId, i, chunks[i],
            JSON.stringify(embResults[i].embedding), now
          );
        }
      });
      insertAll();

      // 状态 → completed
      db.prepare("UPDATE knowledge_documents SET processing_status = 'completed', chunk_count = ?, updated_at = ? WHERE id = ?")
        .run(chunks.length, new Date().toISOString(), docId);

    } catch (err: any) {
      // 状态 → error
      db.prepare("UPDATE knowledge_documents SET processing_status = 'error', error_message = ?, updated_at = ? WHERE id = ?")
        .run(err.message || '处理失败', new Date().toISOString(), docId);
      console.error(`[KnowledgeService] 文档 ${docId} 处理失败:`, err.message);
    }
  }

  // 删除文档及其所有分块
  deleteDocument(docId: string): void {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(docId) as any;
    if (!doc) throw new Error('文档不存在');

    // 删除源文件
    try {
      const filePath = path.isAbsolute(doc.file_path) ? doc.file_path : path.join(config.uploadsDir, doc.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }

    // 删除分块和文档记录
    db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(docId);
    db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(docId);
  }

  // 获取文档列表
  listDocuments(): KnowledgeDocumentSummary[] {
    const db = getDb();
    const kbId = this.ensureDefaultKnowledgeBase();
    return db.prepare(
      'SELECT id, file_name, processing_status, chunk_count, error_message, created_at, file_hash FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY created_at DESC'
    ).all(kbId) as KnowledgeDocumentSummary[];
  }

  // 语义检索
  async searchKnowledge(query: string, topK: number = 5): Promise<KnowledgeSearchResult[]> {
    const db = getDb();
    const kbId = this.ensureDefaultKnowledgeBase();
    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(kbId) as any;

    // 获取所有已完成文档的分块（含嵌入向量和文档名）
    const rows = db.prepare(`
      SELECT c.id, c.content, c.embedding, d.file_name, d.id as doc_id
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.document_id = d.id
      WHERE c.knowledge_base_id = ? AND d.processing_status = 'completed'
    `).all(kbId) as any[];

    if (rows.length === 0) return [];

    // 嵌入查询
    const queryEmb = await embeddingService.embed(query);
    const queryVec = queryEmb.embedding;

    // 余弦相似度召回
    const threshold = kb?.similarity_threshold ?? 0.7;
    const candidates = rows.map(row => {
      let embVec: number[];
      try {
        embVec = JSON.parse(row.embedding);
      } catch {
        return { entry: row, score: 0 };
      }
      const score = cosineSimilarity(queryVec, embVec);
      return { entry: row, score };
    })
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return [];

    // 前20送入重排序
    const topCandidates = candidates.slice(0, 20);
    const docsForRerank = topCandidates.map(c => c.entry.content);

    let ranked: { entry: any; score: number }[];
    try {
      const rerankResult = await rerankerService.rerank(query, docsForRerank);
      const rerankMap = new Map(rerankResult.map(r => [r.index, r.score]));
      ranked = topCandidates.map((c, i) => ({
        entry: c.entry,
        score: rerankMap.get(i) ?? c.score,
      }));
      ranked.sort((a, b) => b.score - a.score);
    } catch {
      // 重排序失败降级
      ranked = topCandidates;
    }

    return ranked.slice(0, topK).map(r => ({
      chunk_id: r.entry.id,
      content: r.entry.content,
      score: r.score,
      document_name: r.entry.file_name,
      document_id: r.entry.doc_id,
    }));
  }

  // 统计信息
  getStats(): { documentCount: number; chunkCount: number } {
    const db = getDb();
    const kbId = this.ensureDefaultKnowledgeBase();
    const docCount = (db.prepare(
      'SELECT COUNT(*) as c FROM knowledge_documents WHERE knowledge_base_id = ? AND processing_status = ?'
    ).get(kbId, 'completed') as any)?.c || 0;
    const chunkCount = (db.prepare(
      'SELECT COUNT(*) as c FROM knowledge_chunks WHERE knowledge_base_id = ?'
    ).get(kbId) as any)?.c || 0;
    return { documentCount: docCount, chunkCount };
  }
}

export const knowledgeService = new KnowledgeService();
