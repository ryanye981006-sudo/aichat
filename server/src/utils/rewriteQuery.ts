// 查询改写：将用户模糊查询改写为更精确的检索查询
// 失败时降级到原始 query，零风险
import { aiSdkService } from '../services/AiSdkService.js';

const REWRITE_PROMPT = `你是一个知识库检索优化助手。将用户的模糊或复杂问题改写为1-3个简洁、具体的检索查询，以便在知识库中找到最相关的内容。

规则：
- 将模糊问题拆解为具体的子问题
- 去除口语化表达，保留核心信息需求
- 每个查询独立、完整、可检索
- 只返回 JSON 数组，不要解释
- 如果原始查询已经足够清晰，返回包含原始查询的数组

示例：
用户问题："那个项目怎么样了"
→ ["项目进度报告", "项目当前状态", "项目里程碑完成情况"]

用户问题："Python 列表和元组的区别是什么"
→ ["Python 列表和元组的区别"]

用户问题：`;

/**
 * 改写查询，返回 1-3 个精确检索查询
 * 失败时返回原始 query 的单元素数组（降级策略）
 */
export async function rewriteQuery(
  query: string,
  providerId: string,
  modelId: string
): Promise<string[]> {
  try {
    const result = await aiSdkService.chat(
      [
        { role: 'system', content: REWRITE_PROMPT },
        { role: 'user', content: query },
      ],
      modelId,
      providerId,
      0.1,
    );

    // 提取 JSON 数组：去除可能的 markdown 代码块标记
    let cleaned = result.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[rewriteQuery] LLM 返回非 JSON 格式，降级到原始查询:', cleaned.slice(0, 100));
      return [query];
    }

    const rewritten: unknown = JSON.parse(jsonMatch[0]);
    if (Array.isArray(rewritten) && rewritten.length > 0 &&
        rewritten.every(item => typeof item === 'string' && item.trim())) {
      return rewritten.map((s: string) => s.trim());
    }

    console.warn('[rewriteQuery] JSON 解析结果格式异常，降级到原始查询');
    return [query];
  } catch (err) {
    console.warn('[rewriteQuery] 查询改写失败，降级到原始查询:', (err as Error).message);
    return [query];
  }
}

/**
 * 安全改写：不需要助手模型信息时的降级版本
 * 直接返回原始查询
 */
export function rewriteQueryFallback(query: string): string[] {
  return [query];
}
