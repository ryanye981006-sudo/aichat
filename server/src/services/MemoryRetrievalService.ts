// L2 记忆检索管线：双通道 + RRF + Reranker + 五信号加权
// 对应产品方案 §记忆检索评分策略 + §检索管线

import { getDb } from '../db/connection.js';
import { embeddingService } from './EmbeddingService.js';
import { rerankerService } from './RerankerService.js';
import { cosineSimilarity } from '../utils/vector.js';
import { config } from '../config.js';
import type { MemorySearchResult } from '../types/index.js';

export class MemoryRetrievalService {
  // 搜索记忆（主入口）
  async searchMemory(query: string, limit: number = 5): Promise<MemorySearchResult[]> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;
    if (!settings?.enabled) return [];

    try {
      const { embedding: queryEmb } = await embeddingService.embed(query);

      // 获取所有活跃记忆
      const memories = db.prepare(`
        SELECT m.id, m.content, m.topic, m.type, m.created_at, m.importance, m.access_count,
               m.last_accessed, m.valid_from, m.embedding,
               (SELECT COUNT(*) FROM memory_source_links WHERE memory_id = m.id) AS source_count
        FROM memories m
        WHERE m.is_deleted = 0 AND m.status = 'active'
      `).all() as any[];

      if (memories.length === 0) return [];

      // Phase 2: 双通道检索
      const now = Date.now();
      const halfLifeMs = config.timeDecayHalfLifeDays * 24 * 3600 * 1000;

      // 通道 A：向量搜索 × time_decay（时间感知）
      const channelA = memories.map(m => {
        const emb = JSON.parse(m.embedding || '[]');
        const cosine = emb.length > 0 ? Math.max(0, cosineSimilarity(queryEmb, emb)) : 0;
        const daysSince = (now - new Date(m.created_at).getTime()) / (24 * 3600 * 1000);
        const timeDecay = Math.pow(0.5, daysSince / config.timeDecayHalfLifeDays);
        return { ...m, score: cosine * timeDecay, cosine };
      }).sort((a, b) => b.score - a.score).slice(0, config.channelTopN);

      // 通道 B：纯向量搜索（语义兜底，不做时间衰减）
      const channelB = memories.map(m => {
        const emb = JSON.parse(m.embedding || '[]');
        const cosine = emb.length > 0 ? Math.max(0, cosineSimilarity(queryEmb, emb)) : 0;
        return { ...m, score: cosine, cosine };
      }).sort((a, b) => b.score - a.score).slice(0, config.channelTopN);

      // Phase 3: RRF 融合
      const fused = this.rrfFusion(channelA, channelB, config.rrfSmoothingFactor);
      const top20 = fused.slice(0, config.rrfTopN);

      // Phase 4: Reranker 精排
      const docs = top20.map((m: any) => {
        // 构造富格式 reranker input
        const topicPart = m.topic ? `[${m.topic}] ` : '';
        return `${topicPart}${m.content}`;
      });

      const rerankResults = await rerankerService.rerank(query, docs);
      const rerankScores = new Map(rerankResults.map(r => [r.index, r.score]));

      const reranked = top20.map((m: any, i: number) => ({
        ...m,
        rerankScore: rerankScores.get(i) || m.cosine,
      }));

      // Phase 5: 时间修正（独立中间筛选步骤）
      const timeCorrected = reranked.map((m: any) => {
        const daysSince = (Date.now() - new Date(m.created_at).getTime()) / (24 * 3600 * 1000);
        const timeDecay = Math.pow(0.5, daysSince / config.timeDecayHalfLifeDays);
        const corrected = m.rerankScore * timeDecay;
        return { ...m, corrected, timeDecay };
      });

      // 按 corrected 排序取 top-10
      const top10 = timeCorrected.sort((a: any, b: any) => b.corrected - a.corrected).slice(0, config.rerankerTopN);

      // Phase 6: 五信号加权
      const finalScored = top10.map((m: any) => {
        const semantic = m.rerankScore;
        const hoursSinceAccess = m.last_accessed
          ? (Date.now() - new Date(m.last_accessed).getTime()) / (3600 * 1000)
          : 720; // 从未被访问，给一个较大的默认值
        const recency = Math.exp(-config.recencyDecayRate * hoursSinceAccess);
        const timeDecay = m.timeDecay;
        const frequency = 1 - Math.exp(-config.frequencyGrowthRate * m.access_count);
        const importance = m.importance || 0.5;

        const sw = config.signalWeights;
        const finalScore = sw.semantic * semantic + sw.recency * recency
          + sw.timeDecay * timeDecay + sw.frequency * frequency + sw.importance * importance;

        return { ...m, finalScore };
      }).sort((a: any, b: any) => b.finalScore - a.finalScore).slice(0, limit);

      // Phase 7: 更新访问统计
      for (const m of finalScored) {
        db.prepare(`
          UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?
        `).run(m.id);
      }

      return finalScored.map((m: any) => ({
        memory_id: m.id,
        content: m.content,
        topic: m.topic,
        type: m.type,
        created_at: m.created_at,
        importance: m.importance,
        source_count: m.source_count,
      }));
    } catch (err) {
      console.error('[MemoryRetrieval] 检索失败:', err);
      return [];
    }
  }

  // 召回记忆关联的原始对话（工具 2）
  async recallContext(memoryId: string): Promise<{
    memory_id: string;
    topic: string | null;
    turns: { turn_index: number; role: string; content: string; created_at: string }[];
    sources: { source_id: string; name: string; type: string }[];
  } | null> {
    const db = getDb();
    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as any;
    if (!memory) return null;

    // 获取关联 chunk
    const links = db.prepare(
      'SELECT chunk_id FROM memory_source_links WHERE memory_id = ?'
    ).all(memoryId) as any[];

    if (links.length === 0) {
      return { memory_id: memoryId, topic: memory.topic, turns: [], sources: [] };
    }

    const turns: any[] = [];
    const sources: any[] = [];

    for (const link of links) {
      // 获取 chunk 关联的消息
      const chunkMessages = db.prepare(`
        SELECT cm.turn_index, cm.role, m.content, m.created_at
        FROM chunk_messages cm
        JOIN messages m ON cm.message_id = m.id
        WHERE cm.chunk_id = ?
        ORDER BY cm.turn_index ASC
      `).all(link.chunk_id) as any[];

      turns.push(...chunkMessages);

      // 获取附件和网页检索（仅名称和类型）
      const attachments = db.prepare(`
        SELECT DISTINCT ma.id, ma.name, ma.type
        FROM chunk_messages cm
        JOIN message_attachments ma ON cm.message_id = ma.message_id
        WHERE cm.chunk_id = ?
      `).all(link.chunk_id) as any[];

      const webRetrievals = db.prepare(`
        SELECT DISTINCT mwr.id, mwr.url AS name, 'web' AS type
        FROM chunk_messages cm
        JOIN message_web_retrievals mwr ON cm.message_id = mwr.message_id
        WHERE cm.chunk_id = ?
      `).all(link.chunk_id) as any[];

      sources.push(...attachments.map(a => ({ source_id: a.id, name: a.name, type: a.type })));
      sources.push(...webRetrievals.map(w => ({ source_id: w.id, name: w.name, type: 'web' })));
    }

    return { memory_id: memoryId, topic: memory.topic, turns, sources };
  }

  // 召回附件全文和网页检索内容（工具 3）
  async recallSources(memoryId: string, sourceIds?: string[]): Promise<{
    memory_id: string;
    attachments: { source_id: string; name: string; type: string; content: string }[];
    web_retrievals: { source_id: string; url: string; title: string; snippet: string }[];
  } | null> {
    const db = getDb();
    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as any;
    if (!memory) return null;

    const links = db.prepare(
      'SELECT chunk_id FROM memory_source_links WHERE memory_id = ?'
    ).all(memoryId) as any[];

    if (links.length === 0) {
      return { memory_id: memoryId, attachments: [], web_retrievals: [] };
    }

    const chunkIds = links.map(l => l.chunk_id);
    const placeholders = chunkIds.map(() => '?').join(',');

    // 附件全文
    let attachmentQuery = `
      SELECT DISTINCT ma.id AS source_id, ma.name, ma.type, ma.path
      FROM chunk_messages cm
      JOIN message_attachments ma ON cm.message_id = ma.message_id
      WHERE cm.chunk_id IN (${placeholders})
    `;
    if (sourceIds?.length) {
      attachmentQuery += ` AND ma.id IN (${sourceIds.map(() => '?').join(',')})`;
    }

    const attachments = (db.prepare(attachmentQuery).all(
      ...chunkIds, ...(sourceIds || [])
    ) as any[]).map(a => ({
      source_id: a.source_id,
      name: a.name,
      type: a.type,
      content: `[文件: ${a.name}, 路径: ${a.path}]`,
    }));

    // 网页检索全文
    let webQuery = `
      SELECT DISTINCT mwr.id AS source_id, mwr.url, mwr.title, mwr.snippet
      FROM chunk_messages cm
      JOIN message_web_retrievals mwr ON cm.message_id = mwr.message_id
      WHERE cm.chunk_id IN (${placeholders})
    `;
    if (sourceIds?.length) {
      webQuery += ` AND mwr.id IN (${sourceIds.map(() => '?').join(',')})`;
    }

    const webRetrievals = db.prepare(webQuery).all(
      ...chunkIds, ...(sourceIds || [])
    ) as any[];

    return { memory_id: memoryId, attachments, web_retrievals: webRetrievals };
  }

  // --- 私有方法 ---

  // RRF 融合：用排名而非分数融合，两边量纲不同也能公平合并
  private rrfFusion(channelA: any[], channelB: any[], k: number): any[] {
    const rankMap = new Map<string, { aRank: number; bRank: number; item: any }>();

    channelA.forEach((m, i) => {
      rankMap.set(m.id, { aRank: i + 1, bRank: Infinity, item: m });
    });
    channelB.forEach((m, i) => {
      const entry = rankMap.get(m.id);
      if (entry) {
        entry.bRank = i + 1;
      } else {
        rankMap.set(m.id, { aRank: Infinity, bRank: i + 1, item: m });
      }
    });

    const fused = Array.from(rankMap.values()).map(({ aRank, bRank, item }) => ({
      ...item,
      rrfScore: 1 / (k + aRank) + 1 / (k + bRank),
    }));

    return fused.sort((a, b) => b.rrfScore - a.rrfScore);
  }
}

export const memoryRetrievalService = new MemoryRetrievalService();
