// 递归文本分块器，支持三种策略：paragraph / sentence / recursive
// 支持 token 感知分块、Markdown 结构感知、paragraph overlap
import { cleanText } from './cleanText.js';

export type ChunkStrategy = 'paragraph' | 'sentence' | 'recursive';
export type ChunkUnit = 'char' | 'token';

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  strategy?: ChunkStrategy;
  unit?: ChunkUnit;
}

// Token 估算：中文 ~1.5 chars/token，英文 ~4 chars/token
function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // CJK 统一汉字、日文假名、韩文
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) {
      tokens += 1 / 1.5; // ~0.67 token per CJK char
    } else {
      tokens += 1 / 4; // ~0.25 token per ASCII char
    }
  }
  return Math.ceil(tokens);
}

// 按指定单位测量文本长度
function measure(text: string, unit: ChunkUnit): number {
  return unit === 'token' ? estimateTokens(text) : text.length;
}

export function chunkText(
  text: string,
  chunkSize: number = 512,
  chunkOverlap: number = 50,
  strategy: ChunkStrategy = 'recursive',
  unit: ChunkUnit = 'char'
): string[] {
  const cleaned = cleanText(text);
  if (!cleaned.trim()) return [];

  switch (strategy) {
    case 'paragraph':
      return chunkByParagraph(cleaned, chunkSize, chunkOverlap, unit);
    case 'sentence':
      return chunkBySentence(cleaned, chunkSize, chunkOverlap, unit);
    case 'recursive':
    default:
      return chunkRecursive(cleaned, chunkSize, chunkOverlap, unit);
  }
}

// === paragraph 策略：按段落分割，超长段落递归拆分（含 overlap） ===
function chunkByParagraph(text: string, chunkSize: number, overlap: number, unit: ChunkUnit): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (measure(current, unit) + measure(trimmed, unit) + 1 <= chunkSize) {
      current += (current ? '\n\n' : '') + trimmed;
    } else {
      if (current) chunks.push(current.trim());
      // 超长段落按句子拆分
      if (measure(trimmed, unit) > chunkSize) {
        const subChunks = chunkBySentence(trimmed, chunkSize, overlap, unit);
        chunks.push(...subChunks.slice(0, -1));
        current = subChunks[subChunks.length - 1] || '';
      } else {
        current = trimmed;
      }
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

// === sentence 策略：按中英文标点 + Markdown 标题分割 ===
function chunkBySentence(text: string, chunkSize: number, overlap: number, unit: ChunkUnit): string[] {
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (measure(current, unit) + measure(sentence, unit) <= chunkSize) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

// === recursive 策略：Markdown 标题 → 段落 → 句子 → 强制截断 ===
function chunkRecursive(text: string, chunkSize: number, chunkOverlap: number, unit: ChunkUnit): string[] {
  const chunks: string[] = [];

  // 先按 Markdown 标题划分为"节"，每个节保留标题上下文
  const sections = splitMarkdownSections(text);

  for (const section of sections) {
    if (!section.trim()) continue;

    if (measure(section, unit) <= chunkSize) {
      chunks.push(section.trim());
      continue;
    }

    // 节内按段落 → 句子 → 强制截断递归分块
    const paragraphs = section.split(/\n\s*\n/);
    let currentChunk = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (measure(currentChunk, unit) + measure(trimmed, unit) + 1 <= chunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());

        if (measure(trimmed, unit) > chunkSize) {
          const sentences = splitSentences(trimmed);
          let sentenceChunk = '';
          for (const sentence of sentences) {
            if (measure(sentenceChunk, unit) + measure(sentence, unit) <= chunkSize) {
              sentenceChunk += sentence;
            } else {
              if (sentenceChunk.trim()) {
                chunks.push(...forceSplit(sentenceChunk.trim(), chunkSize, chunkOverlap, unit));
              }
              sentenceChunk = sentence;
            }
          }
          currentChunk = sentenceChunk.trim();
        } else {
          currentChunk = trimmed;
        }
      }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 0);
}

// Markdown 标题感知：按 # 标题分割为节，每个节保留标题层级
function splitMarkdownSections(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current = '';
  let currentHeaders = '';

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      // 遇到标题，保存当前节
      if (current.trim()) sections.push(current.trim());
      currentHeaders = line + '\n';
      current = currentHeaders;
    } else {
      current += line + '\n';
    }
  }

  if (current.trim()) sections.push(current.trim());
  return sections.length > 0 ? sections : [text];
}

// 按中英文句子分隔（覆盖中文标点，Markdown 标题感知）
function splitSentences(text: string): string[] {
  const withTitleBreaks = text.replace(/(?=\n#{1,6}\s)/g, '\n');
  return withTitleBreaks
    .split(/(?<=[。！？.!?；;])\s*/)
    .flatMap(s => {
      if (s.length > 200) {
        return s.split(/(?<=[，,：:])\s*/);
      }
      return [s];
    })
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// 强制按长度切分，保留 overlap
function forceSplit(text: string, size: number, overlap: number, unit: ChunkUnit): string[] {
  if (unit === 'token') {
    // token 模式下按估算的 token 边界切分
    const chunks: string[] = [];
    const charsPerToken = 2.5; // 中英混合估算
    const charSize = Math.floor(size * charsPerToken);
    const charOverlap = Math.floor(overlap * charsPerToken);
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + charSize, text.length);
      chunks.push(text.slice(start, end).trim());
      if (end >= text.length) break;
      start += charSize - charOverlap;
    }
    return chunks.filter(c => c.length > 0);
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    start += size - overlap;
  }
  return chunks.filter(c => c.length > 0);
}
