// RAG 知识库管线：文档加载 → 分块 → 多模态嵌入 → 存储（含元数据）→ 搜索
// 知识库使用硬编码的 DashScope 多模态 embedding + 硅基流动 rerank
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/connection.js';
import { loaderService } from './LoaderService.js';
import { multimodalEmbeddingService } from './MultimodalEmbeddingService.js';
import { chunkText } from '../utils/chunk.js';
import { cosineSimilarity } from '../utils/vector.js';
import { rewriteQuery } from '../utils/rewriteQuery.js';
import { rerankerService } from '../reranker/RerankerService.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

// 搜索结果
interface SearchResult {
  content: string;
  score: number;
  documentName: string;
  chunkId: string;
  metadata: any;
  chunkType?: string;
}

export class KnowledgeService {
  // 处理文档（加载 → 分块 → 多模态嵌入 → 存储元数据）
  async processDocument(documentId: string): Promise<void> {
    const db = getDb();

    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as any;
    if (!doc) throw new Error('文档不存在');

    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(doc.knowledge_base_id) as any;
    if (!kb) throw new Error('知识库不存在');

    // 检查文档是否已被删除（处理过程中可能被用户删除）
    const ensureExists = (): void => {
      const exists = db.prepare('SELECT id FROM knowledge_documents WHERE id = ?').get(documentId);
      if (!exists) throw new Error('文档已被删除，处理中止');
    };

    // 构建处理配置快照
    const processingConfig = {
      chunk_strategy: kb.chunk_strategy || 'recursive',
      chunk_size: kb.chunk_size,
      chunk_overlap: kb.chunk_overlap,
      embedding_model: config.dashscopeModel,
      embedding_dimension: config.dashscopeDimension,
      processed_at: new Date().toISOString(),
    };

    try {
      // Step 1: 加载文档
      db.prepare("UPDATE knowledge_documents SET processing_status = 'loading', updated_at = datetime('now') WHERE id = ?").run(documentId);
      ensureExists();

      let loadResult: Awaited<ReturnType<typeof loaderService.loadFile>>;
      switch (doc.source_type) {
        case 'file':
          loadResult = await loaderService.loadFile(doc.file_path, '');
          break;
        case 'url':
          loadResult = await loaderService.loadUrl(doc.file_path || '');
          break;
        case 'note':
          loadResult = await loaderService.loadNote(doc.file_path || '');
          break;
        default:
          throw new Error(`不支持的来源类型: ${doc.source_type}`);
      }
      const text = loadResult.text;
      const images = loadResult.images;
      ensureExists();

      // Step 2: 分块
      db.prepare("UPDATE knowledge_documents SET processing_status = 'chunking', updated_at = datetime('now') WHERE id = ?").run(documentId);
      ensureExists();

      const strategy = (kb.chunk_strategy || 'recursive') as 'paragraph' | 'sentence' | 'recursive';
      const textChunks = chunkText(text, kb.chunk_size, kb.chunk_overlap, strategy);

      // 保存图片到磁盘，准备图片块
      const imageChunks: { content: string; imagePath: string; page: number }[] = [];
      if (images.length > 0) {
        const imagesDir = path.join(config.uploadsDir, 'images');
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
        for (const img of images) {
          const chunkId = uuidv4();
          const imgFileName = `${chunkId}.png`;
          const imgPath = path.join(imagesDir, imgFileName);
          fs.writeFileSync(imgPath, img.data);
          imageChunks.push({
            content: `![image](/api/knowledge/images/${chunkId})`,
            imagePath: imgPath,
            page: img.page,
          });
        }
      }

      // Step 3: 多模态嵌入
      db.prepare("UPDATE knowledge_documents SET processing_status = 'embedding', updated_at = datetime('now') WHERE id = ?").run(documentId);
      ensureExists();

      // 删除旧的分块和图片
      const oldChunks = db.prepare('SELECT id, content FROM knowledge_chunks WHERE document_id = ?').all(documentId) as any[];
      for (const oldChunk of oldChunks) {
        // 清理旧图片文件
        if (oldChunk.content?.includes('/api/knowledge/images/')) {
          const match = oldChunk.content.match(/\/api\/knowledge\/images\/([a-f0-9-]+)/);
          if (match) {
            const oldImgPath = path.join(config.uploadsDir, 'images', `${match[1]}.png`);
            try { fs.unlinkSync(oldImgPath); } catch { /* 忽略 */ }
          }
        }
      }
      db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId);

      // 批量嵌入文本块
      const textEmbeddings = textChunks.length > 0
        ? await multimodalEmbeddingService.embedTextBatch(textChunks)
        : [];

      // 逐个嵌入图片块
      const imageEmbeddings: number[][] = [];
      for (const imgChunk of imageChunks) {
        const base64 = fs.readFileSync(imgChunk.imagePath).toString('base64');
        const embedding = await multimodalEmbeddingService.embedImage(base64, 'image/png');
        imageEmbeddings.push(embedding);
      }
      ensureExists();

      // 构建分块元数据
      const chunkMetadata = {
        embedding_model: config.dashscopeModel,
        embedding_dimension: config.dashscopeDimension,
        chunk_strategy: strategy,
        chunk_size: kb.chunk_size,
        chunk_overlap: kb.chunk_overlap,
      };

      // 事务批量插入
      const insertChunk = db.prepare(
        `INSERT INTO knowledge_chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, metadata, chunk_type, image_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      let chunkIndex = 0;
      const transaction = db.transaction(() => {
        ensureExists();
        // 文本块
        for (let i = 0; i < textChunks.length; i++) {
          insertChunk.run(
            uuidv4(),
            documentId,
            kb.id,
            chunkIndex++,
            textChunks[i],
            JSON.stringify(textEmbeddings[i] || []),
            JSON.stringify(chunkMetadata),
            'text',
            null,
          );
        }
        // 图片块
        for (let i = 0; i < imageChunks.length; i++) {
          insertChunk.run(
            uuidv4(),
            documentId,
            kb.id,
            chunkIndex++,
            imageChunks[i].content,
            JSON.stringify(imageEmbeddings[i] || []),
            JSON.stringify({ ...chunkMetadata, page: imageChunks[i].page }),
            'image',
            imageChunks[i].imagePath,
          );
        }
      });
      transaction();

      const totalChunks = textChunks.length + imageChunks.length;

      // Step 4: 完成
      const updated = db.prepare(
        "UPDATE knowledge_documents SET processing_status = 'completed', chunk_count = ?, processing_config = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(totalChunks, JSON.stringify(processingConfig), documentId);
      if (updated.changes === 0) return;

    } catch (err) {
      const msg = (err as Error).message;
      const exists = db.prepare('SELECT id FROM knowledge_documents WHERE id = ?').get(documentId);
      if (exists) {
        db.prepare(
          "UPDATE knowledge_documents SET processing_status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(msg, documentId);
      }
      throw err;
    }
  }

  // 搜索知识库（统一使用多模态 embedding 向量）
  async search(
    knowledgeBaseIds: string[],
    query: string,
    topK?: number,
    threshold?: number,
    assistantProviderId?: string,
    assistantModelId?: string,
    trackRecalls: boolean = false,
  ): Promise<SearchResult[]> {
    if (!knowledgeBaseIds.length) return [];

    const db = getDb();
    const kbs = db.prepare(
      `SELECT * FROM knowledge_bases WHERE id IN (${knowledgeBaseIds.map(() => '?').join(',')})`
    ).all(...knowledgeBaseIds) as any[];

    if (!kbs.length) return [];

    const k = topK || kbs[0].search_top_k || 5;
    const th = threshold || kbs[0].similarity_threshold || 0.7;

    const t0 = Date.now();

    // 查询改写
    const shouldRewrite = kbs.some((kb: any) => kb.enable_query_rewrite)
      && assistantProviderId && assistantModelId;

    const queries = shouldRewrite
      ? await rewriteQuery(query, assistantProviderId!, assistantModelId!)
      : [query];
    if (shouldRewrite) {
      console.log(`[KnowledgeService] 查询改写耗时 ${Date.now() - t0}ms，改写为 ${queries.length} 个查询`);
    }

    // 加载所有目标知识库的 chunks
    const kbIds = kbs.map((kb: any) => kb.id);
    const placeholders = kbIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT kc.id, kc.content, kc.embedding, kc.metadata, kc.chunk_type, kd.file_name
       FROM knowledge_chunks kc
       JOIN knowledge_documents kd ON kc.document_id = kd.id
       WHERE kc.knowledge_base_id IN (${placeholders})
       AND kd.processing_status = 'completed'`
    ).all(...kbIds) as any[];

    if (rows.length === 0) return [];

    // 预解析嵌入向量
    const chunks = rows.map((r: any) => ({
      id: r.id,
      content: r.content,
      emb: JSON.parse(r.embedding || '[]'),
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      chunkType: r.chunk_type || 'text',
      fileName: r.file_name,
    }));

    // 嵌入所有查询（使用多模态 embedding）
    const allResults: SearchResult[] = [];
    const seenChunks = new Set<string>();

    try {
      for (const q of queries) {
        const queryVec = await multimodalEmbeddingService.embedText(q);
        for (const c of chunks) {
          if (seenChunks.has(c.id)) continue;
          const score = c.emb.length > 0 ? cosineSimilarity(queryVec, c.emb) : 0;
          if (score >= th) {
            seenChunks.add(c.id);
            allResults.push({
              content: c.content,
              score,
              documentName: c.fileName,
              chunkId: c.id,
              metadata: c.metadata,
              chunkType: c.chunkType,
            });
          }
        }
      }
    } catch (err) {
      console.error('[KnowledgeService] 搜索嵌入失败:', err);
      return [];
    }

    const t1 = Date.now();
    if (shouldRewrite) {
      console.log(`[KnowledgeService] 嵌入+检索耗时 ${t1 - t0}ms（含改写），候选 ${allResults.length} 条`);
    }

    // 初始排序
    let sorted = allResults.sort((a, b) => b.score - a.score);

    // 重排序：任一 KB 启用了 rerank 时执行
    const shouldRerank = kbs.some((kb: any) => kb.enable_rerank);
    if (shouldRerank && sorted.length > 0) {
      const tRerank = Date.now();
      const recallSize = Math.min(sorted.length, k * 3);
      const candidates = sorted.slice(0, recallSize);
      sorted = await rerankerService.rerank(query, candidates, k);
      console.log(`[KnowledgeService] 重排序耗时 ${Date.now() - tRerank}ms`);
    } else {
      sorted = sorted.slice(0, k);
    }

    // 递增召回计数
    if (trackRecalls && sorted.length > 0) {
      const incrementRecall = db.prepare(
        'UPDATE knowledge_chunks SET recall_count = recall_count + 1 WHERE id = ?'
      );
      for (const r of sorted) {
        incrementRecall.run(r.chunkId);
      }
    }

    return sorted;
  }
}

export const knowledgeService = new KnowledgeService();
