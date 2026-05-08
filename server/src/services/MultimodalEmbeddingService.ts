// 阿里云 DashScope 多模态 Embedding 服务
// 使用 qwen3-vl-embedding 模型，支持文本和图片嵌入
// 知识库专用，不走 provider/model 体系
import { config } from '../config.js';

export class MultimodalEmbeddingService {
  // 嵌入文本（知识库文本块 + 检索 query）
  async embedText(text: string): Promise<number[]> {
    const body = JSON.stringify({
      model: config.dashscopeModel,
      input: {
        contents: [{ text }],
      },
      parameters: {},
    });

    const response = await fetch(config.dashscopeBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.dashscopeApiKey}`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DashScope embedding API 失败 (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const embedding = data?.output?.embeddings?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error(`DashScope embedding 返回格式异常: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return embedding;
  }

  // 嵌入图片（base64 格式）
  async embedImage(base64: string, mimeType: string): Promise<number[]> {
    const body = JSON.stringify({
      model: config.dashscopeModel,
      input: {
        contents: [{ image: `data:${mimeType};base64,${base64}` }],
      },
      parameters: {},
    });

    const response = await fetch(config.dashscopeBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.dashscopeApiKey}`,
      },
      body,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DashScope image embedding API 失败 (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const embedding = data?.output?.embeddings?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error(`DashScope image embedding 返回格式异常: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return embedding;
  }

  // 批量嵌入文本（逐个调用，因为 API 限制单次只能传 1 个 content）
  async embedTextBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embedText(text);
      results.push(embedding);
    }
    return results;
  }

  // 获取嵌入维度
  get dimension(): number {
    return config.dashscopeDimension;
  }
}

export const multimodalEmbeddingService = new MultimodalEmbeddingService();
