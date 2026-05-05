// 重排序服务：使用 OpenAI 兼容 /v1/rerank API 对初步检索结果精排
// 失败时降级到原始余弦相似度排序
import { getDb } from '../db/connection.js';

export interface RerankInput {
  content: string;
  score: number;
  documentName: string;
  chunkId: string;
  metadata: any;
}

export interface RerankOutput {
  content: string;
  score: number;
  documentName: string;
  chunkId: string;
  metadata: any;
}

export class RerankerService {
  /**
   * 重排序：召回更多候选（recallFactor × topN），精排后取 topN
   * 失败时降级：返回原始文档按原始分数排序
   */
  async rerank(
    query: string,
    documents: RerankInput[],
    providerId: string,
    modelName: string,
    topN: number = 5
  ): Promise<RerankOutput[]> {
    if (documents.length === 0) return [];

    try {
      const db = getDb();
      const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
      if (!provider?.enabled) {
        console.warn('[Reranker] 提供商不可用，降级到原始排序');
        return this.fallbackSort(documents, topN);
      }

      // 调用 /v1/rerank API（Cohere/Jina/VoyageAI 均兼容）
      const url = `${provider.base_url}/v1/rerank`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model: modelName,
          query,
          documents: documents.map(d => d.content),
          top_n: topN,
        }),
      });

      if (!response.ok) {
        // 尝试不带 /v1 的路径
        const url2 = `${provider.base_url}/rerank`;
        const response2 = await fetch(url2, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify({
            model: modelName,
            query,
            documents: documents.map(d => d.content),
            top_n: topN,
          }),
        });

        if (!response2.ok) {
          const errText = await response2.text();
          console.warn(`[Reranker] Rerank API 调用失败 (${response2.status}): ${errText.slice(0, 200)}，降级到原始排序`);
          return this.fallbackSort(documents, topN);
        }

        return this.parseResponse(response2, documents, topN);
      }

      return this.parseResponse(response, documents, topN);
    } catch (err) {
      console.warn('[Reranker] 重排序异常，降级到原始排序:', (err as Error).message);
      return this.fallbackSort(documents, topN);
    }
  }

  private async parseResponse(
    response: Response,
    documents: RerankInput[],
    topN: number
  ): Promise<RerankOutput[]> {
    const data = await response.json() as any;
    const results = data.results || [];

    return results
      .slice(0, topN)
      .map((r: any) => {
        const doc = documents[r.index];
        return doc
          ? { ...doc, score: r.relevance_score ?? r.score ?? doc.score }
          : null;
      })
      .filter((d: any): d is RerankOutput => d !== null);
  }

  private fallbackSort(documents: RerankInput[], topN: number): RerankOutput[] {
    return documents
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(d => ({ ...d }));
  }
}

export const rerankerService = new RerankerService();
