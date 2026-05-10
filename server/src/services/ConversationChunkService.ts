// 对话三层时间模型：L0 热层（最近 N 轮保留原文）→ L1 温层（语义切分 chunk）→ L2 冷层（记忆提取）
// 对应产品方案 §三层时间模型 + §触发时机

import { getDb } from '../db/connection.js';
import { embeddingService } from './EmbeddingService.js';
import { cosineSimilarity } from '../utils/vector.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';
import type { ConversationChunk } from '../types/index.js';

export class ConversationChunkService {
  // 分配 turn_index：新会话首条为 1
  assignTurnIndex(conversationId: string): number {
    const db = getDb();
    const row = db.prepare(
      'SELECT COALESCE(MAX(turn_index), 0) + 1 AS next FROM messages WHERE conversation_id = ?'
    ).get(conversationId) as { next: number };
    return row.next;
  }

  // 判断是否进入 L1 chunking（l0Rounds 取自助手 context_rounds）
  shouldEnterL1(conversationId: string, l0Rounds: number): boolean {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(DISTINCT turn_index) AS cnt FROM messages WHERE conversation_id = ?'
    ).get(conversationId) as { cnt: number };
    return row.cnt > l0Rounds;
  }

  // 检查 chunk 边界：比较相邻 turn 的语义相似度
  // 前提：turn > L0_RETENTION_ROUNDS
  // 确保存在 open chunk（同步方法，用于首次创建防竞态）
  ensureOpenChunk(conversationId: string, startTurnIndex: number): string {
    const existing = this.getOpenChunk(conversationId);
    if (existing) return existing.id;
    return this.createChunk(conversationId, startTurnIndex);
  }

  checkChunkBoundary(conversationId: string): { closed: boolean; chunkId?: string } {
    const db = getDb();
    const currentChunk = this.getOpenChunk(conversationId);

    if (!currentChunk) {
      // 无 open chunk → 首个超出 L0 的 turn，直接创建新 chunk
      const lastTurn = this.getLastTurnMessages(conversationId, 1);
      if (lastTurn.length === 0) return { closed: false };
      const chunkId = this.createChunk(conversationId, lastTurn[0].turn_index);
      return { closed: false, chunkId };
    }

    // 有 open chunk → 异步边界检测不可用，走异步版本 checkChunkBoundaryAsync
    const recentTurns = this.getLastTurnMessages(conversationId, 2);
    if (recentTurns.length < 2) return { closed: false };
    const turnN = recentTurns[1];
    this.updateChunkEndTurn(currentChunk.id, turnN.turn_index);
    return { closed: false };
  }

  // 检查 chunk 边界（异步版本，用于聊天流程）
  async checkChunkBoundaryAsync(conversationId: string): Promise<{ closed: boolean; chunkId?: string }> {
    const db = getDb();
    const currentChunk = this.getOpenChunk(conversationId);

    if (!currentChunk) {
      const lastTurn = this.getLastTurnMessages(conversationId, 1);
      if (lastTurn.length === 0) return { closed: false };
      const chunkId = this.createChunk(conversationId, lastTurn[0].turn_index);
      return { closed: false, chunkId };
    }

    const recentTurns = this.getLastTurnMessages(conversationId, 2);
    if (recentTurns.length < 2) return { closed: false };

    const turnN = recentTurns[1];
    const turnN1 = recentTurns[0];

    // 轮数上限强制闭合：防止话题长时间不变时 chunk 永不闭合
    const chunkTurnCount = turnN.turn_index - currentChunk.start_turn_index + 1;
    if (chunkTurnCount >= config.maxTurnsPerChunk) {
      console.log(`[ConversationChunk] 轮数上限强制闭合 | chunk=${currentChunk.id} | turns=${chunkTurnCount} | max=${config.maxTurnsPerChunk}`);
      const closedChunkId = this.closeChunk(conversationId);
      const newChunkId = this.createChunk(conversationId, turnN.turn_index);
      return { closed: true, chunkId: newChunkId };
    }

    try {
      const [embN, embN1] = await Promise.all([
        embeddingService.embed(turnN.content),
        embeddingService.embed(turnN1.content),
      ]);

      const sim = cosineSimilarity(embN.embedding, embN1.embedding);

      if (sim < config.chunkSimilarityThreshold) {
        const closedChunkId = this.closeChunk(conversationId);
        const newChunkId = this.createChunk(conversationId, turnN.turn_index);
        return { closed: true, chunkId: newChunkId };
      } else {
        this.updateChunkEndTurn(currentChunk.id, turnN.turn_index);
        return { closed: false };
      }
    } catch (err) {
      console.warn('[ConversationChunk] 异步边界检测 embedding 失败:', err);
      return { closed: false };
    }
  }

  // 关闭当前 open chunk，异步触发记忆提取
  closeChunk(conversationId: string): string {
    const db = getDb();
    const chunk = this.getOpenChunk(conversationId);
    if (!chunk) return '';

    const content = this.buildChunkContent(chunk.id);
    const finalTurnRow = db.prepare(
      'SELECT MAX(turn_index) AS end_turn FROM chunk_messages WHERE chunk_id = ?'
    ).get(chunk.id) as { end_turn: number | null };

    const endTurnIndex = finalTurnRow?.end_turn ?? chunk.end_turn_index ?? chunk.start_turn_index;

    db.prepare(`
      UPDATE conversation_chunks
      SET status = 'closed', content = ?, end_turn_index = ?, closed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(content, endTurnIndex, chunk.id);

    // 异步写入 embedding
    embeddingService.embed(content).then(({ embedding }) => {
      db.prepare('UPDATE conversation_chunks SET embedding = ? WHERE id = ?')
        .run(JSON.stringify(embedding), chunk.id);
    }).catch(err => {
      console.warn('[ConversationChunk] chunk embedding 写入失败:', err);
    });

    // 异步触发记忆提取
    this.extractFromChunk(chunk.id).catch(err => {
      console.error('[ConversationChunk] 记忆提取失败:', err);
    });

    return chunk.id;
  }

  // 获取当前 open chunk
  getOpenChunk(conversationId: string): ConversationChunk | null {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM conversation_chunks WHERE conversation_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
    ).get(conversationId, 'open') as ConversationChunk | null;
  }

  // 更新 chunk 的 end_turn_index
  updateChunkEndTurn(chunkId: string, endTurnIndex: number): void {
    const db = getDb();
    db.prepare(
      'UPDATE conversation_chunks SET end_turn_index = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(endTurnIndex, chunkId);
  }

  // 将对话中尚未归档的消息批量关联到 chunk（幂等，用于首次进入 L1 时回填历史消息）
  addAllMessagesToChunk(chunkId: string, conversationId: string): void {
    const db = getDb();
    const rows = db.prepare(`
      SELECT m.id, m.turn_index, m.role, m.content FROM messages m
      WHERE m.conversation_id = ?
        AND m.memory_enabled = 1 AND m.privacy_mode = 0
        AND m.id NOT IN (SELECT cm.message_id FROM chunk_messages cm)
      ORDER BY m.turn_index ASC
    `).all(conversationId) as { id: string; turn_index: number; role: string; content: string }[];

    if (rows.length === 0) return;

    const insert = db.prepare(
      'INSERT OR IGNORE INTO chunk_messages (id, chunk_id, message_id, turn_index, role) VALUES (?, ?, ?, ?, ?)'
    );
    const updateChunk = db.prepare(
      "UPDATE conversation_chunks SET content = content || ?, updated_at = datetime('now') WHERE id = ?"
    );

    const batchInsert = db.transaction(() => {
      for (const row of rows) {
        insert.run(uuidv4(), chunkId, row.id, row.turn_index, row.role);
        updateChunk.run(`${row.role}: ${row.content}\n`, chunkId);
      }
    });
    batchInsert();
  }

  // 将消息关联到 chunk
  addTurnToChunk(chunkId: string, messageId: string, turnIndex: number, role: string, content: string): void {
    const db = getDb();
    const id = uuidv4();
    db.prepare(
      'INSERT INTO chunk_messages (id, chunk_id, message_id, turn_index, role) VALUES (?, ?, ?, ?, ?)'
    ).run(id, chunkId, messageId, turnIndex, role);

    // 增量追加 content（最终一致性由 closeChunk 的 buildChunkContent 保证）
    db.prepare(
      'UPDATE conversation_chunks SET content = content || ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(`${role}: ${content}\n`, chunkId);
  }

  // 全量重建 chunk content
  buildChunkContent(chunkId: string): string {
    const db = getDb();
    const messages = db.prepare(
      'SELECT cm.role, m.content FROM chunk_messages cm JOIN messages m ON cm.message_id = m.id WHERE cm.chunk_id = ? ORDER BY cm.turn_index ASC'
    ).all(chunkId) as { role: string; content: string }[];

    return messages.map(m => `${m.role}: ${m.content}`).join('\n');
  }

  // 从 chunk 提取记忆（内部调用 MemoryService）
  async extractFromChunk(chunkId: string): Promise<void> {
    const db = getDb();

    // 状态 → extracting（防止并发提取）
    db.prepare(
      "UPDATE conversation_chunks SET status = 'extracting', updated_at = datetime('now') WHERE id = ?"
    ).run(chunkId);

    try {
      // 延迟导入避免循环依赖
      const { memoryService } = await import('./MemoryService.js');

      // 过滤：只处理 memory_enabled=1 AND privacy_mode=0 的消息
      const messages = db.prepare(`
        SELECT cm.role, m.content, cm.message_id
        FROM chunk_messages cm
        JOIN messages m ON cm.message_id = m.id
        WHERE cm.chunk_id = ? AND m.memory_enabled = 1 AND m.privacy_mode = 0
        ORDER BY cm.turn_index ASC
      `).all(chunkId) as { role: string; content: string; message_id: string }[];

      if (messages.length === 0) {
        // 无符合条件的消息，直接标记为已提取
        db.prepare(
          "UPDATE conversation_chunks SET status = 'extracted', extracted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).run(chunkId);
        return;
      }

      // 构建提取内容
      const content = messages.map(m => `${m.role}: ${m.content}`).join('\n');

      // 调用 MemoryService 提取
      const facts = await memoryService.extractFacts(
        messages.map(m => ({ role: m.role, content: m.content }))
      );

      // 按 action 分发
      const extractionTrigger = 'topic_shift'; // 由 closeChunk 路径触发

      for (const fact of facts) {
        try {
          switch (fact.action) {
            case 'ADD':
              await memoryService.addMemoryWithSource(fact.fact, fact.topic || null, chunkId, undefined, fact.importance);
              break;
            case 'UPDATE':
              if (fact.existing_id) {
                const newId = await memoryService.addMemoryWithSource(fact.fact, fact.topic || null, chunkId, undefined, fact.importance);
                await memoryService.invalidateMemory(fact.existing_id, newId);
              }
              break;
            case 'DELETE':
              if (fact.existing_id) {
                await memoryService.invalidateMemory(fact.existing_id);
              }
              break;
          }
        } catch (err) {
          console.error(`[ConversationChunk] 处理记忆失败 (${fact.action}):`, err);
        }
      }

      // 完成：状态 → extracted
      db.prepare(
        "UPDATE conversation_chunks SET status = 'extracted', extracted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(chunkId);
    } catch (err) {
      console.error('[ConversationChunk] 从 chunk 提取记忆失败:', err);
      // 失败时重置为 closed，等待下次扫描重试
      db.prepare(
        "UPDATE conversation_chunks SET status = 'closed', updated_at = datetime('now') WHERE id = ?"
      ).run(chunkId);
    }
  }

  // 处理过期/空闲会话（触发 B：会话空闲超时触发）
  async processStaleConversations(idleThresholdMs: number): Promise<void> {
    const db = getDb();
    // 使用 SQLite datetime 函数统一比较，避免 JS ISO 与 SQLite local time 格式不一致
    const thresholdSeconds = Math.floor(idleThresholdMs / 1000);

    // 扫描 open/closed 状态的过期 chunk（同时检查 conversation 和 chunk 的 updated_at）
    const staleChunks = db.prepare(`
      SELECT cc.* FROM conversation_chunks cc
      JOIN conversations c ON cc.conversation_id = c.id
      WHERE (strftime('%s', 'now') - strftime('%s', c.updated_at)) > ?
        AND cc.status IN ('open', 'closed')
    `).all(thresholdSeconds) as ConversationChunk[];

    if (staleChunks.length > 0) {
      console.log(`[ConversationChunk] 扫描到 ${staleChunks.length} 个过期 chunk | open=${staleChunks.filter(c => c.status === 'open').length} closed=${staleChunks.filter(c => c.status === 'closed').length}`);
    }

    // 额外扫描 stuck 在 extracting 状态的 chunk（30 分钟超时）
    const stuckChunks = db.prepare(`
      SELECT * FROM conversation_chunks
      WHERE status = 'extracting' AND (strftime('%s', 'now') - strftime('%s', updated_at)) > 1800
    `).all() as ConversationChunk[];

    for (const chunk of stuckChunks) {
      console.log(`[ConversationChunk] 重置 stuck chunk | id=${chunk.id}`);
      db.prepare(
        "UPDATE conversation_chunks SET status = 'closed', updated_at = datetime('now') WHERE id = ?"
      ).run(chunk.id);
    }

    for (const chunk of staleChunks) {
      if (chunk.status === 'open') {
        console.log(`[ConversationChunk] 空闲闭合 chunk | id=${chunk.id} | conv=${chunk.conversation_id}`);
        this.closeChunk(chunk.conversation_id);
      } else if (chunk.status === 'closed') {
        console.log(`[ConversationChunk] 空闲提取 chunk | id=${chunk.id}`);
        this.extractFromChunk(chunk.id).catch(err => {
          console.error('[ConversationChunk] 空闲提取失败:', err);
        });
      }
    }

    // 重试 stuck chunk
    for (const chunk of stuckChunks) {
      console.log(`[ConversationChunk] 重试 stuck chunk 提取 | id=${chunk.id}`);
      this.extractFromChunk(chunk.id).catch(err => {
        console.error('[ConversationChunk] stuck chunk 重试失败:', err);
      });
    }
  }

  // 获取 chunk 关联的消息（供 recall_context 使用）
  getChunkSourceMessages(chunkId: string): { turn_index: number; role: string; content: string; created_at: string }[] {
    const db = getDb();
    return db.prepare(`
      SELECT cm.turn_index, cm.role, m.content, m.created_at
      FROM chunk_messages cm
      JOIN messages m ON cm.message_id = m.id
      WHERE cm.chunk_id = ?
      ORDER BY cm.turn_index ASC
    `).all(chunkId) as any[];
  }

  // 获取 chunk 关联的附件（供 recall_sources 使用）
  getChunkAttachments(chunkId: string): { attachments: any[]; webRetrievals: any[] } {
    const db = getDb();
    const attachments = db.prepare(`
      SELECT DISTINCT ma.id, ma.type, ma.name, ma.path
      FROM chunk_messages cm
      JOIN message_attachments ma ON cm.message_id = ma.message_id
      WHERE cm.chunk_id = ?
    `).all(chunkId) as any[];

    const webRetrievals = db.prepare(`
      SELECT DISTINCT mwr.id, mwr.url, mwr.title, mwr.snippet
      FROM chunk_messages cm
      JOIN message_web_retrievals mwr ON cm.message_id = mwr.message_id
      WHERE cm.chunk_id = ?
    `).all(chunkId) as any[];

    return { attachments, webRetrievals };
  }

  // 获取 L0 热层消息（最近 N 轮，供 system prompt 使用，l0Rounds 取自助手 context_rounds）
  getL0Messages(conversationId: string, l0Rounds: number): { role: string; content: string; turn_index: number }[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT role, content, turn_index
      FROM messages
      WHERE conversation_id = ?
      ORDER BY turn_index DESC
      LIMIT ?
    `).all(conversationId, l0Rounds) as any[];

    return rows.reverse();
  }

  // --- 私有方法 ---

  private createChunk(conversationId: string, startTurnIndex: number): string {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO conversation_chunks (id, conversation_id, start_turn_index, end_turn_index)
      VALUES (?, ?, ?, ?)
    `).run(id, conversationId, startTurnIndex, startTurnIndex);
    return id;
  }

  // 获取最近 N 个 turn 的代表消息（每个 turn 取最新一条，按 turn_index 升序）
  private getLastTurnMessages(conversationId: string, count: number): { turn_index: number; role: string; content: string }[] {
    const db = getDb();
    // 每个 turn 取最新一条消息作为该 turn 的代表（通常是 assistant 回复）
    return db.prepare(`
      SELECT m.turn_index, m.role, m.content
      FROM messages m
      WHERE m.conversation_id = ?
        AND m.id = (
          SELECT id FROM messages
          WHERE conversation_id = m.conversation_id AND turn_index = m.turn_index
          ORDER BY created_at DESC LIMIT 1
        )
      ORDER BY m.turn_index DESC
      LIMIT ?
    `).all(conversationId, count).reverse() as any[];
  }
}

export const conversationChunkService = new ConversationChunkService();
