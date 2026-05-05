// RAG 知识库管线：文档加载 → 分块 → 批量嵌入 → 存储（含元数据）→ 搜索
import { getDb } from '../db/connection.js';
import { embeddingService } from './EmbeddingService.js';
import { loaderService } from './LoaderService.js';
import { chunkText } from '../utils/chunk.js';
import { cosineSimilarity } from '../utils/vector.js';
import { rewriteQuery } from '../utils/rewriteQuery.js';
import { rerankerService } from '../reranker/RerankerService.js';
import { v4 as uuidv4 } from 'uuid';

// 嵌入配置分组键
interface EmbedGroupKey {
  providerId: string;
  modelName: string;
}

// 搜索结果
interface SearchResult {
  content: string;
  score: number;
  documentName: string;
  chunkId: string;
  metadata: any;
}

export class KnowledgeService {
  // 处理文档（加载 → 分块 → 批量嵌入 → 存储元数据）
  async processDocument(documentId: string): Promise<void> {
    const db = getDb();

    const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as any;
    if (!doc) throw new Error('文档不存在');

    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(doc.knowledge_base_id) as any;
    if (!kb) throw new Error('知识库不存在');

    // 构建处理配置快照
    const processingConfig = {
      chunk_strategy: kb.chunk_strategy || 'recursive',
      chunk_size: kb.chunk_size,
      chunk_overlap: kb.chunk_overlap,
      embedding_provider_id: kb.embedding_provider_id || null,
      embedding_model_id: kb.embedding_model_id || null,
      processed_at: new Date().toISOString(),
    };

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

      // Step 2: 分块（使用 KB 配置的分块策略）
      db.prepare("UPDATE knowledge_documents SET processing_status = 'chunking', updated_at = datetime('now') WHERE id = ?").run(documentId);

      const strategy = (kb.chunk_strategy || 'recursive') as 'paragraph' | 'sentence' | 'recursive';
      const chunks = chunkText(text, kb.chunk_size, kb.chunk_overlap, strategy);

      // Step 3: 批量嵌入并存储（含元数据）
      db.prepare("UPDATE knowledge_documents SET processing_status = 'embedding', updated_at = datetime('now') WHERE id = ?").run(documentId);

      // 删除旧的分块
      db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId);

      // 获取实际使用的嵌入配置
      let providerId: string | null = kb.embedding_provider_id || null;
      let modelName: string | null = kb.embedding_model_id || null;

      // 如果 KB 没有嵌入配置，尝试使用全局默认
      if (!providerId || !modelName) {
        const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;
        if (settings?.embedding_provider_id && settings?.embedding_model_id) {
          const globalProvider = db.prepare('SELECT * FROM providers WHERE id = ?').get(settings.embedding_provider_id) as any;
          const globalModel = db.prepare('SELECT * FROM models WHERE id = ?').get(settings.embedding_model_id) as any;
          if (globalProvider?.enabled && globalModel) {
            providerId = settings.embedding_provider_id;
            modelName = globalModel.name;
          }
        }
      }

      // 批量嵌入
      let embeddings: { embedding: number[]; dimension: number }[];
      if (providerId && modelName) {
        embeddings = await embeddingService.embedBatchWith(chunks, providerId, modelName);
      } else {
        embeddings = await embeddingService.embedBatch(chunks);
      }

      // 构建分块元数据
      const chunkMetadata = {
        embedding_provider_id: providerId,
        embedding_model_name: modelName,
        embedding_dimension: embeddings[0]?.dimension || 0,
        chunk_strategy: strategy,
        chunk_size: kb.chunk_size,
        chunk_overlap: kb.chunk_overlap,
      };

      // 事务批量插入
      const insertChunk = db.prepare(
        'INSERT INTO knowledge_chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      const transaction = db.transaction(() => {
        for (let i = 0; i < chunks.length; i++) {
          insertChunk.run(
            uuidv4(),
            documentId,
            kb.id,
            i,
            chunks[i],
            JSON.stringify(embeddings[i]?.embedding || []),
            JSON.stringify(chunkMetadata)
          );
        }
      });
      transaction();

      // Step 4: 完成，记录处理配置
      db.prepare(
        "UPDATE knowledge_documents SET processing_status = 'completed', chunk_count = ?, processing_config = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(chunks.length, JSON.stringify(processingConfig), documentId);

    } catch (err) {
      const msg = (err as Error).message;
      db.prepare(
        "UPDATE knowledge_documents SET processing_status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(msg, documentId);
      throw err;
    }
  }

  // 搜索知识库（按嵌入配置分组，每组独立向量化查询，合并结果）
  // 支持查询改写：传入 assistantProviderId + assistantModelId 以启用 LLM 改写
  async search(
    knowledgeBaseIds: string[],
    query: string,
    topK?: number,
    threshold?: number,
    assistantProviderId?: string,
    assistantModelId?: string
  ): Promise<SearchResult[]> {
    if (!knowledgeBaseIds.length) return [];

    const db = getDb();
    const kbs = db.prepare(
      `SELECT * FROM knowledge_bases WHERE id IN (${knowledgeBaseIds.map(() => '?').join(',')})`
    ).all(...knowledgeBaseIds) as any[];

    if (!kbs.length) return [];

    // 默认参数
    const k = topK || kbs[0].search_top_k || 5;
    const th = threshold || kbs[0].similarity_threshold || 0.7;

    // 查询改写：任一 KB 启用了改写，且有助手模型可用时执行
    const shouldRewrite = kbs.some((kb: any) => kb.enable_query_rewrite)
      && assistantProviderId && assistantModelId;

    const queries = shouldRewrite
      ? await rewriteQuery(query, assistantProviderId!, assistantModelId!)
      : [query];

    // 辅助函数：获取 KB 的实际嵌入配置
    const resolveEmbedConfig = (kb: any): EmbedGroupKey | null => {
      if (kb.embedding_provider_id && kb.embedding_model_id) {
        const model = db.prepare('SELECT name FROM models WHERE id = ?').get(kb.embedding_model_id) as any;
        if (model) {
          return { providerId: kb.embedding_provider_id, modelName: model.name };
        }
      }
      // 尝试全局默认
      const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;
      if (settings?.embedding_provider_id && settings?.embedding_model_id) {
        const model = db.prepare('SELECT name FROM models WHERE id = ?').get(settings.embedding_model_id) as any;
        if (model) {
          return { providerId: settings.embedding_provider_id, modelName: model.name };
        }
      }
      return null;
    };

    const groupKey = (key: EmbedGroupKey) => `${key.providerId}:${key.modelName}`;

    // 按嵌入配置分组知识库
    const groups = new Map<string, { key: EmbedGroupKey; kbIds: string[] }>();
    for (const kb of kbs) {
      const config = resolveEmbedConfig(kb);
      if (!config) continue;
      const gkey = groupKey(config);
      if (!groups.has(gkey)) {
        groups.set(gkey, { key: config, kbIds: [] });
      }
      groups.get(gkey)!.kbIds.push(kb.id);
    }

    if (groups.size === 0) return [];

    // 对每个改写后的查询分别搜索，合并去重
    const seenChunks = new Set<string>();
    const allResults: SearchResult[] = [];

    for (const q of queries) {
      for (const [, group] of groups) {
        try {
          // 生成该组的查询向量
          const { embedding: queryVec } = await embeddingService.embedWith(
            q, group.key.providerId, group.key.modelName
          );

          // 查询该组所有 KB 的 chunks
          const placeholders = group.kbIds.map(() => '?').join(',');
          const chunks = db.prepare(
            `SELECT kc.id, kc.content, kc.embedding, kc.metadata, kd.file_name
             FROM knowledge_chunks kc
             JOIN knowledge_documents kd ON kc.document_id = kd.id
             WHERE kc.knowledge_base_id IN (${placeholders})
             AND kd.processing_status = 'completed'`
          ).all(...group.kbIds) as any[];

          for (const c of chunks) {
            if (seenChunks.has(c.id)) continue;
            const emb = JSON.parse(c.embedding || '[]');
            const score = emb.length > 0 ? cosineSimilarity(queryVec, emb) : 0;
            if (score >= th) {
              seenChunks.add(c.id);
              allResults.push({
                content: c.content,
                score,
                documentName: c.file_name,
                chunkId: c.id,
                metadata: c.metadata ? JSON.parse(c.metadata) : null,
              });
            }
          }
        } catch (err) {
          console.error(`[KnowledgeService] 嵌入组 [${groupKey(group.key)}] 搜索失败:`, err);
          // 该组失败不影响其他组
        }
      }
    }

    // 初步排序
    let sorted = allResults.sort((a, b) => b.score - a.score);

    // 重排序：任一 KB 启用了 rerank 且有配置时执行
    const rerankKb = kbs.find((kb: any) => kb.enable_rerank && kb.rerank_provider_id && kb.rerank_model_id);
    if (rerankKb && sorted.length > 0) {
      const recallSize = Math.min(sorted.length, k * 3); // 召回更多候选
      const candidates = sorted.slice(0, recallSize);
      sorted = await rerankerService.rerank(
        query, candidates, rerankKb.rerank_provider_id, rerankKb.rerank_model_id, k
      );
    } else {
      sorted = sorted.slice(0, k);
    }

    return sorted;
  }
}

export const knowledgeService = new KnowledgeService();
