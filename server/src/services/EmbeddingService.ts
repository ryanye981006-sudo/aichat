// 统一嵌入服务：调用 OpenAI 兼容的 /v1/embeddings API
import { getDb } from '../db/connection.js';
import { config } from '../config.js';

export interface EmbeddingResult {
  embedding: number[];
  dimension: number;
}

export class EmbeddingService {
  // 获取文本的向量嵌入
  async embed(text: string): Promise<EmbeddingResult> {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM memory_settings WHERE id = 1').get() as any;

    if (!settings?.embedding_provider_id || !settings?.embedding_model_id) {
      // 没有配置嵌入模型，使用默认 1536 维零向量（后续会替换为实际调用）
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

    return this.callEmbeddingAPI(provider, model.name, text);
  }

  // 批量嵌入
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

    const results: EmbeddingResult[] = [];
    // 批量处理，每批最多 20 个
    const batchSize = 20;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const url = `${provider.base_url}/embeddings`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model: model.name,
          input: batch,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`嵌入 API 调用失败 (${response.status}): ${errText}`);
      }

      const data = await response.json() as any;
      for (const item of data.data) {
        results.push({
          embedding: item.embedding,
          dimension: item.embedding.length,
        });
      }
    }

    return results;
  }

  // 使用指定提供商和模型进行嵌入（知识库专用）
  async embedWith(text: string, providerId: string, modelName: string): Promise<EmbeddingResult> {
    const db = getDb();
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
    if (!provider?.enabled) {
      throw new Error('指定的嵌入提供商不可用');
    }
    return this.callEmbeddingAPI(provider, modelName, text);
  }

  private async callEmbeddingAPI(provider: any, modelName: string, text: string): Promise<EmbeddingResult> {
    const url = `${provider.base_url}/v1/embeddings`;  // 尝试 v1 路径
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.api_key}`,
      },
      body: JSON.stringify({
        model: modelName,
        input: text,
      }),
    });

    // 如果 /v1/embeddings 失败，尝试不带 v1 的路径
    if (!response.ok) {
      const url2 = `${provider.base_url}/embeddings`;
      response = await fetch(url2, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model: modelName,
          input: text,
        }),
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`嵌入 API 调用失败 (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) {
      throw new Error('嵌入 API 返回格式异常');
    }

    return {
      embedding,
      dimension: embedding.length,
    };
  }
}

export const embeddingService = new EmbeddingService();
