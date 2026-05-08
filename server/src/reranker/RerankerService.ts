// 重排序服务：使用硅基流动 API (BAAI/bge-reranker-v2-m3) 对初步检索结果精排
// 失败时降级到原始余弦相似度排序
// 硬编码使用硅基流动，不走 provider/model 体系
import { config } from '../config.js';

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
   * 重排序：召回更多候选，精排后取 topN
   * 失败时降级：返回原始文档按原始分数排序
   */
  async rerank(
    query: string,
    documents: RerankInput[],
    topN: number = 5
  ): Promise<RerankOutput[]> {
    if (documents.length === 0) return [];

    if (!config.siliconflowApiKey) {
      console.warn('[Reranker] 未配置 SILICONFLOW_API_KEY，降级到原始排序');
      return this.fallbackSort(documents, topN);
    }

    try {
      const rerankUrl = `${config.siliconflowBaseUrl}/rerank`;
      const response = await fetch(rerankUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.siliconflowApiKey}`,
        },
        body: JSON.stringify({
          model: config.siliconflowRerankModel,
          query,
          documents: documents.map(d => d.content),
          top_n: topN,
          return_documents: false,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[Reranker] Rerank API 调用失败 (${response.status}): ${errText.slice(0, 200)}，降级到原始排序`);
        return this.fallbackSort(documents, topN);
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
