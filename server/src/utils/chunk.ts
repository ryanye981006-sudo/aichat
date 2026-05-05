// 递归文本分块器，支持三种策略：paragraph / sentence / recursive
export type ChunkStrategy = 'paragraph' | 'sentence' | 'recursive';

export function chunkText(
  text: string,
  chunkSize: number = 512,
  chunkOverlap: number = 50,
  strategy: ChunkStrategy = 'recursive'
): string[] {
  if (!text.trim()) return [];
  const chunks: string[] = [];

  switch (strategy) {
    case 'paragraph':
      return chunkByParagraph(text, chunkSize);
    case 'sentence':
      return chunkBySentence(text, chunkSize, chunkOverlap);
    case 'recursive':
    default:
      return chunkRecursive(text, chunkSize, chunkOverlap);
  }
}

// === paragraph 策略：仅按段落分割，超长段落不拆分 ===
function chunkByParagraph(text: string, chunkSize: number): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 1 <= chunkSize) {
      current += (current ? '\n\n' : '') + trimmed;
    } else {
      if (current) chunks.push(current.trim());
      current = trimmed;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

// === sentence 策略：按中英文标点 + Markdown 标题分割 ===
function chunkBySentence(text: string, chunkSize: number, overlap: number): string[] {
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length <= chunkSize) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

// === recursive 策略：段落 → 句子 → 强制截断（当前行为增强版） ===
function chunkRecursive(text: string, chunkSize: number, chunkOverlap: number): string[] {
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
            sentenceChunk += sentence;
          } else {
            if (sentenceChunk.trim()) {
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

// 按中英文句子分隔（增强：覆盖中文分号、逗号长句断点，Markdown 标题感知）
function splitSentences(text: string): string[] {
  // 首先在 Markdown 标题前断开
  const withTitleBreaks = text.replace(/(?=\n#{1,6}\s)/g, '\n');
  // 按中英文标点分割
  return withTitleBreaks
    .split(/(?<=[。！？.!?；;])\s*/)
    .flatMap(s => {
      // 对分号/逗号分隔的长句进一步拆分
      if (s.length > 200) {
        return s.split(/(?<=[，,：:])\s*/);
      }
      return [s];
    })
    .map(s => s.trim())
    .filter(s => s.length > 0);
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
  return chunks.filter(c => c.length > 0);
}
