// RAG 知识库管线：文档加载 → 分块 → 嵌入 → 存储 → 搜索
import { getDb } from '../db/connection.js';
import { embeddingService } from './EmbeddingService.js';
import { loaderService } from './LoaderService.js';
import { chunkText } from '../utils/chunk.js';
import { cosineSimilarity } from '../utils/vector.js';
import { v4 as uuidv4 } from 'uuid';

export class KnowledgeService {
  // 处理文档（加载 → 分块 → 嵌入）
  async processDocument(documentId: string): Promise<void> {
    const db = getDb();

    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as any;
    if (!doc) throw new Error('文档不存在');

    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(doc.knowledge_base_id) as any;
    if (!kb) throw new Error('知识库不存在');

    try {
      // Step 1: 加载文本
      db.prepare("UPDATE knowledge_documents SET processing_status = 'loading', updated_at = datetime('now') WHERE id = ?").run(documentId);

      let text: string;
      switch (doc.source_type) {
        case 'file':
          text = await loaderService.loadFile(doc.file_path, '');
          break;
        case 'url':
          text = await loaderService.loadUrl(doc.file_path || '');
          break;
        case 'note':
          text = await loaderService.loadNote(doc.file_path || '');
          break;
        default:
          throw new Error(`不支持的来源类型: ${doc.source_type}`);
      }

      // Step 2: 分块
      db.prepare("UPDATE knowledge_documents SET processing_status = 'chunking', updated_at = datetime('now') WHERE id = ?").run(documentId);

      const chunks = chunkText(text, kb.chunk_size, kb.chunk_overlap);

      // Step 3: 嵌入并存储
      db.prepare("UPDATE knowledge_documents SET processing_status = 'embedding', updated_at = datetime('now') WHERE id = ?").run(documentId);

      // 删除旧的分块
      db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId);

      const insertChunk = db.prepare(
        'INSERT INTO knowledge_chunks (id, document_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?, ?)'
      );

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
          const { embedding } = kb.embedding_provider_id && kb.embedding_model_id
            ? await embeddingService.embedWith(chunk, kb.embedding_provider_id, kb.embedding_model_id)
            : await embeddingService.embed(chunk);

          insertChunk.run(uuidv4(), documentId, i, chunk, JSON.stringify(embedding));
        } catch (err) {
          console.error(`[KnowledgeService] 嵌入分块 ${i} 失败:`, err);
        }
      }

      // Step 4: 完成
      db.prepare(
        "UPDATE knowledge_documents SET processing_status = 'completed', chunk_count = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(chunks.length, documentId);

    } catch (err) {
      const msg = (err as Error).message;
      db.prepare(
        "UPDATE knowledge_documents SET processing_status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(msg, documentId);
      throw err;
    }
  }

  // 搜索知识库
  async search(
    knowledgeBaseIds: string[],
    query: string,
    topK?: number,
    threshold?: number
  ): Promise<{ content: string; score: number; documentName: string }[]> {
    if (!knowledgeBaseIds.length) return [];

    const db = getDb();
    const kbs = db.prepare(
      `SELECT * FROM knowledge_bases WHERE id IN (${knowledgeBaseIds.map(() => '?').join(',')})`
    ).all(...knowledgeBaseIds) as any[];

    if (!kbs.length) return [];

    // 使用第一个知识库的嵌入设置
    const kb = kbs[0];
    const k = topK || kb.search_top_k || 5;
    const th = threshold || kb.similarity_threshold || 0.7;

    try {
      const { embedding: queryVec } = kb.embedding_provider_id && kb.embedding_model_id
        ? await embeddingService.embedWith(query, kb.embedding_provider_id, kb.embedding_model_id)
        : await embeddingService.embed(query);

      const docIds = kb.embedding_provider_id && kb.embedding_model_id ? kbs : kbs;
      const placeholders = knowledgeBaseIds.map(() => '?').join(',');

      const chunks = db.prepare(
        `SELECT kc.id, kc.content, kc.embedding, kd.file_name
         FROM knowledge_chunks kc
         JOIN knowledge_documents kd ON kc.document_id = kd.id
         WHERE kd.knowledge_base_id IN (${placeholders})
         AND kd.processing_status = 'completed'`
      ).all(...knowledgeBaseIds) as any[];

      const results = chunks
        .map(c => {
          const emb = JSON.parse(c.embedding || '[]');
          const score = emb.length > 0 ? cosineSimilarity(queryVec, emb) : 0;
          return { content: c.content, score, documentName: c.file_name };
        })
        .filter(r => r.score >= th)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      return results;
    } catch (err) {
      console.error('[KnowledgeService] 知识库搜索失败:', err);
      return [];
    }
  }
}

export const knowledgeService = new KnowledgeService();
