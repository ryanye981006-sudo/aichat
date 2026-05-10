// 记忆生命周期管理：提取 → 去重 → 嵌入 → 存储/更新/软删除
import { getDb } from '../db/connection.js';
import { embeddingService } from './EmbeddingService.js';
import { aiSdkService as aiService } from './AiSdkService.js'
import { sha256 } from '../utils/hash.js';
import { cosineSimilarity } from '../utils/vector.js';
import { MEMORY_EXTRACT_PROMPT } from '../utils/promptTemplates.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';
import type { FactExtraction } from '../types/index.js';

export class MemoryService {
  // 从对话中提取记忆事实
  async extractFacts(messages: { role: string; content: string }[]): Promise<FactExtraction[]> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;

    if (!settings?.enabled) return [];
    if (!settings?.llm_provider_id || !settings?.llm_model_id) {
      console.warn('[MemoryService] 未配置记忆提取模型');
      return [];
    }

    const conversationText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      const result = await aiService.chat(
        [
          { role: 'system', content: MEMORY_EXTRACT_PROMPT },
          { role: 'user', content: `请从以下对话中提取记忆事实：\n\n${conversationText}` },
        ],
        settings.llm_model_id,
        settings.llm_provider_id,
        0.1
      );

      // 增强 JSON 解析：去除 markdown 代码块标记，定位首尾括号
      let cleaned = result.trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
        console.warn('[MemoryService] 无法从 LLM 输出中提取 JSON 数组，原始输出:', result.slice(0, 200));
        return [];
      }

      const jsonStr = cleaned.slice(firstBracket, lastBracket + 1);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        console.warn('[MemoryService] JSON 解析失败，原始输出:', result.slice(0, 200));
        return [];
      }

      if (!Array.isArray(parsed)) {
        console.warn('[MemoryService] LLM 返回非数组格式');
        return [];
      }

      const validActions = ['ADD', 'UPDATE', 'DELETE'];
      const facts: FactExtraction[] = [];
      for (const item of parsed) {
        if (item && typeof item === 'object' && typeof item.fact === 'string' && item.fact.trim()) {
          const action = typeof item.action === 'string' ? item.action.toUpperCase() : '';
          if (validActions.includes(action)) {
            facts.push({
              fact: item.fact.trim(),
              topic: typeof (item as any).topic === 'string' ? (item as any).topic : undefined,
              action: action as 'ADD' | 'UPDATE' | 'DELETE',
              existing_id: typeof item.existing_id === 'string' ? item.existing_id : null,
            });
          }
        }
      }

      if (facts.length === 0 && parsed.length > 0) {
        console.warn('[MemoryService] 所有条目验证失败，原始输出:', result.slice(0, 200));
      }

      return facts;
    } catch (err) {
      console.error('[MemoryService] 记忆提取失败:', err);
      return [];
    }
  }

  // 处理提取的记忆事实（旧接口，兼容现有 chat.ts）
  async processFacts(facts: FactExtraction[]): Promise<void> {
    if (!facts.length) return;
    const db = getDb();

    for (const fact of facts) {
      try {
        switch (fact.action) {
          case 'ADD':
            await this.addMemory(fact.fact);
            break;
          case 'UPDATE':
            if (fact.existing_id) {
              const newId = await this.addMemoryWithSource(fact.fact, fact.topic || null, '');
              await this.invalidateMemory(fact.existing_id, newId);
            } else {
              await this.addMemory(fact.fact);
            }
            break;
          case 'DELETE':
            if (fact.existing_id) {
              await this.invalidateMemory(fact.existing_id);
            }
            break;
        }
      } catch (err) {
        console.error(`[MemoryService] 处理记忆失败 (${fact.action}):`, err);
      }
    }
  }

  // 搜索记忆（基础向量搜索，保留兼容）
  async search(query: string): Promise<{ id: string; content: string; score: number }[]> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;
    if (!settings?.enabled) return [];

    try {
      const { embedding } = await embeddingService.embed(query);

      const memories = db.prepare(
        "SELECT id, content, embedding FROM memories WHERE is_deleted = 0 AND status = 'active'"
      ).all() as any[];

      const results = memories
        .map(m => {
          const emb = JSON.parse(m.embedding || '[]');
          const score = emb.length > 0 ? cosineSimilarity(embedding, emb) : 0;
          return { id: m.id, content: m.content, score };
        })
        .filter(r => r.score >= config.memorySimilarityThreshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      return results;
    } catch (err) {
      console.error('[MemoryService] 记忆搜索失败:', err);
      return [];
    }
  }

  // 获取所有活跃记忆（注入到聊天上下文 — 旧接口，不再被 chat 流程调用）
  async getMemoriesForChat(): Promise<string> {
    return '';
  }

  // --- 新增方法 ---

  // 带 source_links 的记忆存储
  async addMemoryWithSource(content: string, topic: string | null, chunkId: string, sourceConversationId?: string): Promise<string> {
    const db = getDb();
    const hash = sha256(content);

    const existing = db.prepare("SELECT id FROM memories WHERE hash = ? AND is_deleted = 0").get(hash) as any;
    if (existing) {
      // 已存在，仍创建 source_link
      this.createSourceLink(existing.id, chunkId).catch(() => {});
      return existing.id;
    }

    const { importance, specificity, properNouns, numbers, totalWords } = this.computeImportance(content);
    const { embedding } = await embeddingService.embed(content);

    // 向量去重
    const allMemories = db.prepare(
      "SELECT id, embedding FROM memories WHERE is_deleted = 0 AND status = 'active'"
    ).all() as any[];

    for (const m of allMemories) {
      try {
        const emb = JSON.parse(m.embedding || '[]');
        if (emb.length > 0 && cosineSimilarity(embedding, emb) >= config.memorySimilarityThreshold) {
          await this.createSourceLink(m.id, chunkId);
          return m.id;
        }
      } catch {}
    }

    const id = uuidv4();
    const metadata = JSON.stringify({
      proper_noun_count: properNouns,
      number_count: numbers,
      total_word_count: totalWords,
      specificity,
      extraction_trigger: 'topic_shift',
      source_chunk_ids: [chunkId],
      proper_nouns: [],
      topic: topic || '',
    });

    db.prepare(`
      INSERT INTO memories (id, content, hash, embedding, topic, importance, metadata,
        source_conversation_id, access_count, valid_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `).run(id, content, hash, JSON.stringify(embedding), topic, importance, metadata, sourceConversationId || null);

    db.prepare(
      "INSERT INTO memory_history (memory_id, action, new_value) VALUES (?, 'ADD', ?)"
    ).run(id, content);

    await this.createSourceLink(id, chunkId);

    return id;
  }

  // 计算重要度：CPU 启发式
  computeImportance(content: string): {
    importance: number;
    specificity: number;
    properNouns: number;
    numbers: number;
    totalWords: number;
  } {
    const words = content.split(/\s+/).length || 1;
    const properNouns = (content.match(/[A-Z][a-z]+|[A-Z]{2,}|[一-鿿]{2,}/g) || []).length;
    const numbers = (content.match(/\d+/g) || []).length;
    const value = Math.min((properNouns + numbers) / words, 1);
    return { importance: value, specificity: value, properNouns, numbers, totalWords: words };
  }

  // 失效旧记忆（保留完整变更链路）
  async invalidateMemory(oldId: string, newId?: string): Promise<void> {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(oldId) as any;
    if (!existing) return;

    db.prepare(`
      UPDATE memories
      SET status = 'invalidated', superseded_by = ?, valid_until = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(newId || null, oldId);

    if (newId) {
      db.prepare(
        "INSERT INTO memory_history (memory_id, action, previous_value, new_value) VALUES (?, 'UPDATE', ?, ?)"
      ).run(oldId, existing.content, '');
    }
  }

  // 记录检索命中
  recordAccess(memoryId: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?
    `).run(memoryId);
  }

  // 获取记忆详情（含 source_links）
  getMemoryDetail(memoryId: string): any | null {
    const db = getDb();
    const memory = db.prepare(`
      SELECT m.*, GROUP_CONCAT(msl.chunk_id) AS chunk_ids
      FROM memories m
      LEFT JOIN memory_source_links msl ON m.id = msl.memory_id
      WHERE m.id = ?
      GROUP BY m.id
    `).get(memoryId) as any;

    if (!memory) return null;

    const sources = db.prepare(
      'SELECT * FROM memory_source_links WHERE memory_id = ?'
    ).all(memoryId) as any[];

    return { ...memory, sources };
  }

  // --- 私有方法 ---

  private async createSourceLink(memoryId: string, chunkId: string): Promise<void> {
    const db = getDb();
    const existing = db.prepare(
      'SELECT id FROM memory_source_links WHERE memory_id = ? AND chunk_id = ?'
    ).get(memoryId, chunkId);
    if (existing) return;

    const id = uuidv4();
    db.prepare(
      'INSERT INTO memory_source_links (id, memory_id, chunk_id) VALUES (?, ?, ?)'
    ).run(id, memoryId, chunkId);
  }

  private async addMemory(content: string): Promise<string> {
    const db = getDb();
    const hash = sha256(content);

    const existing = db.prepare('SELECT id FROM memories WHERE hash = ?').get(hash) as any;
    if (existing) return existing.id;

    const allMemories = db.prepare(
      "SELECT id, content, embedding FROM memories WHERE is_deleted = 0 AND status = 'active'"
    ).all() as any[];

    try {
      const { embedding } = await embeddingService.embed(content);
      const embArray = allMemories.filter(m => {
        try { return JSON.parse(m.embedding || '[]').length > 0; } catch { return false; }
      });

      for (const m of embArray) {
        const sim = cosineSimilarity(embedding, JSON.parse(m.embedding));
        if (sim >= config.memorySimilarityThreshold) return m.id;
      }

      const { importance, specificity, properNouns, numbers, totalWords } = this.computeImportance(content);
      const id = uuidv4();
      const metadata = JSON.stringify({
        proper_noun_count: properNouns, number_count: numbers, total_word_count: totalWords, specificity,
        extraction_trigger: 'legacy', source_chunk_ids: [],
      });

      db.prepare(`
        INSERT INTO memories (id, content, hash, embedding, importance, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, content, hash, JSON.stringify(embedding), importance, metadata);

      db.prepare(
        "INSERT INTO memory_history (memory_id, action, new_value) VALUES (?, 'ADD', ?)"
      ).run(id, content);

      return id;
    } catch (err) {
      console.error('[MemoryService] 添加记忆失败:', err);
      return '';
    }
  }
}

export const memoryService = new MemoryService();
