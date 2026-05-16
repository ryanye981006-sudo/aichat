// 重排序服务：封装硅基流动 rerank API，对外暴露 rerank(query, documents) 方法
// 已在 config.ts 中配置 siliconflowApiKey / siliconflowRerankModel
// 优先从 user_profile 读取用户通过 UI 保存的 Key，否则回退到 .env

import { config } from '../config.js';
import { getDb } from '../db/connection.js';

function getRerankerApiKey(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM user_profile WHERE key = 'reranker_api_key'").get() as any;
  return row?.value || config.siliconflowApiKey;
}

function getRerankerModel(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM user_profile WHERE key = 'reranker_model_name'").get() as any;
  return row?.value || config.siliconflowRerankModel;
}

export class RerankerService {
  // Cross-Encoder 精排：对 query + documents 逐对打分，返回纯语义相关分
  async rerank(query: string, documents: string[]): Promise<{ index: number; score: number }[]> {
    const apiKey = getRerankerApiKey();
    if (!apiKey || documents.length === 0) {
      return documents.map((_, i) => ({ index: i, score: 0 }));
    }

    try {
      const response = await fetch(`${config.siliconflowBaseUrl}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: getRerankerModel(),
          query,
          documents,
          top_n: Math.min(documents.length, config.rerankerTopN),
        }),
      });

      if (!response.ok) {
        console.warn(`[Reranker] API 返回 ${response.status}，降级为原始排序`);
        return documents.map((_, i) => ({ index: i, score: 0 }));
      }

      const data = await response.json() as any;
      if (!data.results || !Array.isArray(data.results)) {
        return documents.map((_, i) => ({ index: i, score: 0 }));
      }

      return data.results.map((r: any) => ({
        index: r.index,
        score: r.relevance_score || 0,
      }));
    } catch (err) {
      console.warn('[Reranker] 调用失败，降级为原始排序:', err);
      return documents.map((_, i) => ({ index: i, score: 0 }));
    }
  }
}

export const rerankerService = new RerankerService();
