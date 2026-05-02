// 余弦相似度计算
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// L2 归一化
export function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

// 向量搜索：在 entries 中找与 queryVec 最相似的 topK 个
export function vectorSearch<T>(
  queryVec: number[],
  entries: T[],
  getEmbedding: (entry: T) => number[],
  topK: number,
  threshold: number
): { entry: T; score: number }[] {
  const results = entries
    .map(entry => {
      const emb = getEmbedding(entry);
      const score = cosineSimilarity(queryVec, emb);
      return { entry, score };
    })
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return results;
}
