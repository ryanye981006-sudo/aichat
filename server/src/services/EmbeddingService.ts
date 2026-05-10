// 统一嵌入服务：调用 OpenAI 兼容的 /v1/embeddings API
// 支持嵌入缓存、指数退避重试、批量嵌入
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { embeddingCache } from './EmbeddingCache.js';
import { getPreferredUrl, getFallbackUrl, markSuccess } from './ApiUrlCache.js';

export interface EmbeddingResult {
  embedding: number[];
  dimension: number;
}

// 判断是否为可重试错误（5xx、429、网络超时）
function isRetryable(status: number | null): boolean {
  if (status === null) return true; // 网络超时
  if (status === 429) return true; // rate limit
  return status >= 500;
}

// 指数退避等待
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class EmbeddingService {
  private maxRetries = 3;
  private retryBaseMs = 1000;

  // 使用默认全局配置嵌入（记忆模块用）
  async embed(text: string): Promise<EmbeddingResult> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;

    if (!settings?.embedding_provider_id || !settings?.embedding_model_id) {
      console.warn('[EmbeddingService] 未配置嵌入模型，使用零向量占位');
      return {
        embedding: new Array(config.defaultEmbeddingDim).fill(0),
        dimension: config.defaultEmbeddingDim
      };
    }

    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(settings.embedding_provider_id) as any;
    if (!provider || !provider.enabled) {
      throw new Error('嵌入提供商未启用或不存在');
    }

    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(settings.embedding_model_id) as any;
    if (!model) {
      throw new Error('嵌入模型不存在');
    }

    // 检查缓存
    const cacheKey = embeddingCache.generateKey(text, provider.id, model.name);
    const cached = embeddingCache.get(cacheKey);
    if (cached) return cached;

    // 调用 API 并写入缓存
    const result = await this.callEmbeddingAPI(provider, model.name, text);
    embeddingCache.set(cacheKey, result, provider.id, model.name);
    return result;
  }

  // 使用指定提供商和模型进行嵌入（知识库专用），含缓存
  async embedWith(text: string, providerId: string, modelName: string): Promise<EmbeddingResult> {
    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
    if (!provider?.enabled) {
      throw new Error('指定的嵌入提供商不可用');
    }

    // 检查缓存
    const cacheKey = embeddingCache.generateKey(text, providerId, modelName);
    const cached = embeddingCache.get(cacheKey);
    if (cached) return cached;

    // 调用 API 并写入缓存
    const result = await this.callEmbeddingAPI(provider, modelName, text);
    embeddingCache.set(cacheKey, result, providerId, modelName);
    return result;
  }

  // 批量嵌入（使用全局配置），含缓存
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;

    if (!settings?.embedding_provider_id || !settings?.embedding_model_id) {
      return texts.map(() => ({
        embedding: new Array(config.defaultEmbeddingDim).fill(0),
        dimension: config.defaultEmbeddingDim
      }));
    }

    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(settings.embedding_provider_id) as any;
    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(settings.embedding_model_id) as any;

    if (!provider?.enabled || !model) {
      throw new Error('嵌入模型配置无效');
    }

    return this.embedBatchWithCache(texts, provider, model.name);
  }

  // 批量嵌入（指定配置），含缓存
  async embedBatchWith(texts: string[], providerId: string, modelName: string): Promise<EmbeddingResult[]> {
    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
    if (!provider?.enabled) {
      throw new Error('指定的嵌入提供商不可用');
    }
    return this.embedBatchWithCache(texts, provider, modelName);
  }

  // 批量嵌入核心逻辑：逐条查缓存，未命中批量调 API
  private async embedBatchWithCache(
    texts: string[],
    provider: any,
    modelName: string
  ): Promise<EmbeddingResult[]> {
    // 生成所有缓存键
    const keys = texts.map(t => embeddingCache.generateKey(t, provider.id, modelName));

    // 批量查询缓存
    const { hits, misses } = embeddingCache.getBatch(keys);

    // 构建结果数组，先填充命中的
    const results: (EmbeddingResult | null)[] = new Array(texts.length).fill(null);
    for (let i = 0; i < keys.length; i++) {
      const hit = hits.get(keys[i]);
      if (hit) results[i] = hit;
    }

    // 未命中的批量调用 API
    if (misses.length > 0) {
      const missTexts = misses.map(i => texts[i]);
      const batchSize = 20;
      const cacheEntries: { key: string; result: EmbeddingResult; providerId: string; modelName: string }[] = [];

      for (let i = 0; i < missTexts.length; i += batchSize) {
        const batch = missTexts.slice(i, i + batchSize);
        const apiResults = await this.callEmbeddingAPIBatch(provider, modelName, batch);

        for (let j = 0; j < batch.length; j++) {
          const origIdx = misses[i + j];
          results[origIdx] = apiResults[j];
          cacheEntries.push({
            key: keys[origIdx],
            result: apiResults[j],
            providerId: provider.id,
            modelName,
          });
        }
      }

      // 批量写入缓存
      embeddingCache.setBatch(cacheEntries);
    }

    return results as EmbeddingResult[];
  }

  // 带重试的单文本嵌入 API 调用
  private async callEmbeddingAPI(provider: any, modelName: string, text: string): Promise<EmbeddingResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const results = await this._doCall(provider, modelName, [text], false);
        return results[0];
      } catch (err) {
        lastError = err as Error;
        const status = (err as any).status as number | undefined;
        if (!isRetryable(status ?? null) || attempt === this.maxRetries - 1) {
          throw err;
        }
        const waitMs = this.retryBaseMs * Math.pow(2, attempt);
        console.warn(`[EmbeddingService] 嵌入 API 调用失败，${waitMs}ms 后重试 (${attempt + 1}/${this.maxRetries}):`, (err as Error).message);
        await delay(waitMs);
      }
    }

    throw lastError!;
  }

  // 带重试的批量嵌入 API 调用
  private async callEmbeddingAPIBatch(provider: any, modelName: string, texts: string[]): Promise<EmbeddingResult[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this._doCall(provider, modelName, texts, true);
      } catch (err) {
        lastError = err as Error;
        const status = (err as any).status as number | undefined;
        if (!isRetryable(status ?? null) || attempt === this.maxRetries - 1) {
          throw err;
        }
        const waitMs = this.retryBaseMs * Math.pow(2, attempt);
        console.warn(`[EmbeddingService] 批量嵌入 API 调用失败，${waitMs}ms 后重试 (${attempt + 1}/${this.maxRetries}):`, (err as Error).message);
        await delay(waitMs);
      }
    }

    throw lastError!;
  }

  // 实际 HTTP 调用，使用 URL 缓存避免每次 fallback 重试
  private async _doCall(
    provider: any,
    modelName: string,
    inputs: string[],
    isBatch: boolean
  ): Promise<EmbeddingResult[]> {
    const body = JSON.stringify({ model: modelName, input: inputs.length === 1 && !isBatch ? inputs[0] : inputs });

    const fetchOptions = (signal: AbortSignal) => ({
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.api_key}`,
      },
      body,
      signal,
    });

    // 优先使用缓存的已验证 URL
    const preferredUrl = getPreferredUrl(provider.id, 'embeddings', provider.base_url);
    let response = await fetch(preferredUrl, fetchOptions(AbortSignal.timeout(30000)));

    if (response.ok) {
      markSuccess(provider.id, 'embeddings', preferredUrl);
    } else {
      // 缓存失效或首次调用，尝试备选路径
      const fallbackUrl = getFallbackUrl(provider.id, 'embeddings', provider.base_url);
      if (fallbackUrl !== preferredUrl) {
        response = await fetch(fallbackUrl, fetchOptions(AbortSignal.timeout(10000)));
        if (response.ok) {
          markSuccess(provider.id, 'embeddings', fallbackUrl);
        }
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      const err = new Error(`嵌入 API 调用失败 (${response.status}): ${errText}`) as any;
      err.status = response.status;
      throw err;
    }

    const data = await response.json() as any;
    const items: any[] = data.data || [];

    return items.map((item: any) => ({
      embedding: item.embedding,
      dimension: item.embedding.length,
    }));
  }
}

export const embeddingService = new EmbeddingService();
