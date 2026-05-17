// 递归文本分块器，支持三种策略：paragraph / sentence / recursive
// 支持 token 感知分块、Markdown 结构感知
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
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) {
      tokens += 1 / 1.5;
    } else {
      tokens += 1 / 4;
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

// === paragraph 策略 ===
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

// === sentence 策略 ===
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
  const sections = splitMarkdownSections(text);

  for (const section of sections) {
    if (!section.trim()) continue;

    if (measure(section, unit) <= chunkSize) {
      chunks.push(section.trim());
      continue;
    }

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

function splitMarkdownSections(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current = '';
  let currentHeaders = '';

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
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

function forceSplit(text: string, size: number, overlap: number, unit: ChunkUnit): string[] {
  if (unit === 'token') {
    const chunks: string[] = [];
    const charsPerToken = 2.5;
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
