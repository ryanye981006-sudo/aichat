// 递归文本分块器
// 策略：先用段落分隔，再按句子分隔，最后强制长度截断
export function chunkText(
  text: string,
  chunkSize: number = 512,
  chunkOverlap: number = 50
): string[] {
  if (!text.trim()) return [];
  const chunks: string[] = [];

  // 第一步：按段落分割
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // 如果当前 chunk + 新段落不超过 chunkSize，追加
    if (currentChunk.length + trimmed.length + 1 <= chunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    } else {
      // 保存当前 chunk
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      // 如果段落本身超过 chunkSize，按句子分割
      if (trimmed.length > chunkSize) {
        const sentences = splitSentences(trimmed);
        let sentenceChunk = '';
        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length <= chunkSize) {
            sentenceChunk += (sentenceChunk ? '' : '') + sentence;
          } else {
            // 句子 chunk 放不下 -> 强制按长度切
            if (sentenceChunk) {
              chunks.push(...forceSplit(sentenceChunk.trim(), chunkSize, chunkOverlap));
            }
            sentenceChunk = sentence;
          }
        }
        if (sentenceChunk.trim()) {
          currentChunk = sentenceChunk.trim();
        } else {
          currentChunk = '';
        }
      } else {
        currentChunk = trimmed;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 0);
}

// 按中英文句子分隔
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？.!?\n])\s*/).filter(s => s.trim());
}

// 强制按长度切分，保留 overlap
function forceSplit(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    start += size - overlap;
  }
  return chunks;
}
