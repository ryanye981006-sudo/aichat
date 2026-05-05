// 记忆生命周期管理：提取 → 去重 → 嵌入 → 存储/更新/软删除
import { getDb } from '../db/connection.js';
import { embeddingService } from './EmbeddingService.js';
import { aiSdkService as aiService } from './AiSdkService.js'
import { sha256 } from '../utils/hash.js';
import { cosineSimilarity } from '../utils/vector.js';
import { MEMORY_EXTRACT_PROMPT } from '../utils/promptTemplates.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

interface FactExtraction {
  fact: string;
  action: 'ADD' | 'UPDATE' | 'DELETE';
  existing_id: string | null;
}

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
      // 去除可能的 markdown 代码块标记
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      // 定位第一个 '[' 和最后一个 ']'
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
      } catch (parseErr) {
        console.warn('[MemoryService] JSON 解析失败，原始输出:', result.slice(0, 200));
        return [];
      }

      if (!Array.isArray(parsed)) {
        console.warn('[MemoryService] LLM 返回非数组格式');
        return [];
      }

      // 逐条验证：必须有 fact 字段，action 必须是 ADD|UPDATE|DELETE
      const validActions = ['ADD', 'UPDATE', 'DELETE'];
      const facts: FactExtraction[] = [];
      for (const item of parsed) {
        if (item && typeof item === 'object' && typeof item.fact === 'string' && item.fact.trim()) {
          const action = typeof item.action === 'string' ? item.action.toUpperCase() : '';
          if (validActions.includes(action)) {
            facts.push({
              fact: item.fact.trim(),
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

  // 处理提取的记忆事实
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
              await this.updateMemory(fact.existing_id, fact.fact);
            }
            break;
          case 'DELETE':
            if (fact.existing_id) {
              await this.softDeleteMemory(fact.existing_id);
            }
            break;
        }
      } catch (err) {
        console.error(`[MemoryService] 处理记忆失败 (${fact.action}):`, err);
      }
    }
  }

  // 搜索记忆
  async search(query: string): Promise<{ id: string; content: string; score: number }[]> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;
    if (!settings?.enabled) return [];

    try {
      const { embedding } = await embeddingService.embed(query);

      const memories = db.prepare(
        'SELECT id, content, embedding FROM memories WHERE is_deleted = 0'
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

  // 获取所有活跃记忆（注入到聊天上下文）
  async getMemoriesForChat(): Promise<string> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;
    if (!settings?.enabled) return '';

    const memories = db.prepare(
      'SELECT content FROM memories WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT 50'
    ).all() as any[];

    if (!memories.length) return '';
    return memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
  }

  private async addMemory(content: string): Promise<void> {
    const db = getDb();
    const hash = sha256(content);

    // SHA256 精确去重
    const existing = db.prepare('SELECT id FROM memories WHERE hash = ?').get(hash) as any;
    if (existing) return;

    // 向量余弦去重
    const allMemories = db.prepare(
      'SELECT id, content, embedding FROM memories WHERE is_deleted = 0'
    ).all() as any[];

    try {
      const { embedding } = await embeddingService.embed(content);
      const embArray = allMemories
        .filter(m => {
          try {
            const emb = JSON.parse(m.embedding || '[]');
            return emb.length > 0;
          } catch { return false; }
        });

      // 检查是否有相似度过高的已有记忆
      for (const m of embArray) {
        const existingEmb = JSON.parse(m.embedding);
        const sim = cosineSimilarity(embedding, existingEmb);
        if (sim >= config.memorySimilarityThreshold) {
          // 相似度过高，视为重复
          return;
        }
      }

      const id = uuidv4();
      db.prepare(
        'INSERT INTO memories (id, content, hash, embedding) VALUES (?, ?, ?, ?)'
      ).run(id, content, hash, JSON.stringify(embedding));

      // 记录审计日志
      db.prepare(
        "INSERT INTO memory_history (memory_id, action, new_value) VALUES (?, 'ADD', ?)"
      ).run(id, content);
    } catch (err) {
      console.error('[MemoryService] 添加记忆失败:', err);
    }
  }

  private async updateMemory(id: string, newContent: string): Promise<void> {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!existing) return;

    const hash = sha256(newContent);

    try {
      const { embedding } = await embeddingService.embed(newContent);
      db.prepare(
        'UPDATE memories SET content = ?, hash = ?, embedding = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).run(newContent, hash, JSON.stringify(embedding), id);

      db.prepare(
        "INSERT INTO memory_history (memory_id, action, previous_value, new_value) VALUES (?, 'UPDATE', ?, ?)"
      ).run(id, existing.content, newContent);
    } catch (err) {
      console.error('[MemoryService] 更新记忆失败:', err);
    }
  }

  private async softDeleteMemory(id: string): Promise<void> {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!existing) return;

    db.prepare(
      "UPDATE memories SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(id);

    db.prepare(
      "INSERT INTO memory_history (memory_id, action, previous_value) VALUES (?, 'DELETE', ?)"
    ).run(id, existing.content);
  }
}

export const memoryService = new MemoryService();
