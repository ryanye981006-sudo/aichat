// 嵌入向量缓存服务
// 使用 SQLite 表存储，key = sha256(providerId:modelName:text)
// LRU 淘汰策略，基于 accessed_at 排序
import { getDb } from '../db/connection.js';
import { createHash } from 'crypto';
import type { EmbeddingResult } from './EmbeddingService.js';

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  estimatedSizeBytes: number;
}

export class EmbeddingCache {
  private maxEntries: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  // 生成缓存键
  generateKey(text: string, providerId: string, modelName: string): string {
    const raw = `${providerId}:${modelName}:${text}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  // 查询缓存，命中时更新访问时间和计数
  get(cacheKey: string): EmbeddingResult | null {
    const db = getDb();
    const row = db.prepare(
      'SELECT embedding, dimension FROM embedding_cache WHERE cache_key = ?'
    ).get(cacheKey) as any;

    if (row) {
      db.prepare(
        "UPDATE embedding_cache SET accessed_at = datetime('now'), access_count = access_count + 1 WHERE cache_key = ?"
      ).run(cacheKey);
      this.hitCount++;
      return {
        embedding: JSON.parse(row.embedding),
        dimension: row.dimension,
      };
    }

    this.missCount++;
    return null;
  }

  // 写入缓存，写入后检查是否需要淘汰
  set(cacheKey: string, result: EmbeddingResult, providerId: string, modelName: string): void {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO embedding_cache (cache_key, embedding, dimension, provider_id, model_name, created_at, accessed_at, access_count)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)`
    ).run(cacheKey, JSON.stringify(result.embedding), result.dimension, providerId, modelName);

    // 异步淘汰超额条目
    this.evict(db);
  }

  // 批量查询缓存，返回命中结果 + 未命中索引列表
  getBatch(
    keys: string[]
  ): { hits: Map<string, EmbeddingResult>; misses: number[] } {
    const db = getDb();
    const hits = new Map<string, EmbeddingResult>();
    const misses: number[] = [];

    for (let i = 0; i < keys.length; i++) {
      const row = db.prepare(
        'SELECT embedding, dimension FROM embedding_cache WHERE cache_key = ?'
      ).get(keys[i]) as any;

      if (row) {
        db.prepare(
          "UPDATE embedding_cache SET accessed_at = datetime('now'), access_count = access_count + 1 WHERE cache_key = ?"
        ).run(keys[i]);
        hits.set(keys[i], {
          embedding: JSON.parse(row.embedding),
          dimension: row.dimension,
        });
        this.hitCount++;
      } else {
        misses.push(i);
        this.missCount++;
      }
    }

    return { hits, misses };
  }

  // 批量写入
  setBatch(
    entries: { key: string; result: EmbeddingResult; providerId: string; modelName: string }[]
  ): void {
    if (entries.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO embedding_cache (cache_key, embedding, dimension, provider_id, model_name, created_at, accessed_at, access_count)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)`
    );
    const transaction = db.transaction(() => {
      for (const e of entries) {
        stmt.run(e.key, JSON.stringify(e.result.embedding), e.result.dimension, e.providerId, e.modelName);
      }
    });
    transaction();
    this.evict(db);
  }

  // LRU 淘汰：超过 maxEntries 时删除最旧的条目
  private evict(db: ReturnType<typeof getDb>): void {
    const count = (db.prepare('SELECT COUNT(*) as c FROM embedding_cache').get() as any).c;
    if (count > this.maxEntries) {
      const excess = count - this.maxEntries;
      db.prepare(
        'DELETE FROM embedding_cache WHERE cache_key IN (SELECT cache_key FROM embedding_cache ORDER BY accessed_at ASC LIMIT ?)'
      ).run(excess);
    }
  }

  // 清除指定 provider + model 的所有缓存（切换嵌入模型时使用）
  invalidateByModel(providerId: string, modelName: string): number {
    const db = getDb();
    const result = db.prepare(
      'DELETE FROM embedding_cache WHERE provider_id = ? AND model_name = ?'
    ).run(providerId, modelName);
    return result.changes;
  }

  // 清除所有缓存
  clear(): number {
    const db = getDb();
    const result = db.prepare('DELETE FROM embedding_cache').run();
    return result.changes;
  }

  // 缓存统计
  getStats(): CacheStats {
    const db = getDb();
    const row = db.prepare(
      "SELECT COUNT(*) as total, COALESCE(SUM(LENGTH(embedding)), 0) as est_size FROM embedding_cache"
    ).get() as any;

    return {
      totalEntries: row.total,
      hitCount: this.hitCount,
      missCount: this.missCount,
      estimatedSizeBytes: row.est_size,
    };
  }
}

export const embeddingCache = new EmbeddingCache();
