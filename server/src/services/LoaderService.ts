// 文档加载器：支持 PDF(mupdf.js)/Word(mammoth)/MD/TXT/URL
// PDF 支持图片提取和结构化文本
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface ExtractedImage {
  data: Buffer;
  mimeType: string;
  page: number;
}

export interface LoadResult {
  text: string;
  images: ExtractedImage[];
  tables: string[]; // Markdown 格式的表格
}

export class LoaderService {
  async loadFile(filePath: string, mimeType: string): Promise<LoadResult> {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(config.uploadsDir, filePath);
    const ext = path.extname(fullPath).toLowerCase();

    switch (ext) {
      case '.txt':
      case '.md':
      case '.markdown':
        return { text: fs.readFileSync(fullPath, 'utf-8'), images: [], tables: [] };

      case '.pdf':
        return this.loadPdf(fullPath);

      case '.docx':
        return this.loadDocx(fullPath);

      case '.doc':
        throw new Error('暂不支持 .doc 格式，请转换为 .docx');

      default:
        try {
          return { text: fs.readFileSync(fullPath, 'utf-8'), images: [], tables: [] };
        } catch {
          throw new Error(`不支持的文件格式: ${ext}`);
        }
    }
  }

  async loadUrl(url: string): Promise<LoadResult> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`无法访问 URL (${response.status})`);
    }
    const html = await response.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, images: [], tables: [] };
  }

  async loadNote(content: string): Promise<LoadResult> {
    return { text: content, images: [], tables: [] };
  }

  /**
   * 判断 PDF 是否为扫描件/纯图片（提取文本量极少）
   * 阈值：总文本 < 100 字符 或 平均每页 < 50 字符
   */
  isScannedPdf(loadResult: LoadResult, pageCount?: number): boolean {
    const textLen = (loadResult.text || '').trim().length;
    if (textLen < 100) return true;
    if (pageCount && pageCount > 0 && textLen / pageCount < 50) return true;
    return false;
  }

  /**
   * 将 PDF 逐页渲染为 PNG（供 vision 模型直接阅读扫描件）
   * 返回每页的 PNG Buffer 和 mimeType
   */
  async renderPagesAsImages(filePath: string): Promise<{ data: Buffer; mimeType: string; page: number }[]> {
    const mupdf = await import('mupdf');
    const data = fs.readFileSync(filePath);
    const doc = mupdf.Document.openDocument(data, 'application/pdf');
    const pages: { data: Buffer; mimeType: string; page: number }[] = [];

    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB);
      if (pix) {
        const png = pix.asPNG();
        pages.push({
          data: Buffer.from(png),
          mimeType: 'image/png',
          page: i + 1,
        });
      }
    }

    return pages;
  }

  private async loadPdf(filePath: string): Promise<LoadResult> {
    try {
      const mupdf = await import('mupdf');
      const data = fs.readFileSync(filePath);
      const doc = mupdf.Document.openDocument(data, 'application/pdf');
      const images: ExtractedImage[] = [];
      let text = '';

      for (let i = 0; i < doc.countPages(); i++) {
        const page = doc.loadPage(i);

        // 结构化文本提取（保留阅读顺序）
        const st = page.toStructuredText('preserve-whitespace');
        if (st) {
          const json = JSON.parse(st.asJSON());
          text += extractStructuredText(json) + '\n\n';
        }

        // 图片提取：通过 StructuredTextWalker 的 onImageBlock 回调
        try {
          if (st) {
            st.walk({
              onImageBlock(_bbox: any, _transform: any, image: any) {
                try {
                  const pix = image.toPixmap();
                  if (pix) {
                    const png = pix.asPNG();
                    images.push({
                      data: Buffer.from(png),
                      mimeType: 'image/png',
                      page: i + 1,
                    });
                  }
                } catch {
                  // 单张图片提取失败不影响整体
                }
              },
            });
          }
        } catch {
          // 图片提取不支持时跳过
        }
      }

      return { text, images, tables: [] };
    } catch (err) {
      throw new Error(`PDF 解析失败: ${(err as Error).message}`);
    }
  }

  private async loadDocx(filePath: string): Promise<LoadResult> {
    try {
      const mammoth = await import('mammoth');

      // 提取文本（保留表格结构）
      const result = await mammoth.extractRawText({ path: filePath });
      let text = result.value;

      // 尝试提取表格（通过 HTML 转换获取表格结构）
      try {
        const htmlResult = await mammoth.convertToHtml({ path: filePath });
        const tables = extractTablesFromHtml(htmlResult.value);
        if (tables.length > 0) {
          // 将 Markdown 表格追加到文本末尾
          text += '\n\n' + tables.join('\n\n');
          return { text, images: [], tables };
        }
      } catch {
        // 表格提取失败时使用纯文本结果
      }

      return { text, images: [], tables: [] };
    } catch (err) {
      throw new Error(`Word 文档解析失败: ${(err as Error).message}`);
    }
  }
}

// 从 mupdf 结构化文本 JSON 中提取纯文本
function extractStructuredText(json: any): string {
  if (!json || !json.blocks) return '';

  const lines: string[] = [];
  for (const block of json.blocks) {
    if (block.type === 'text' && block.lines) {
      for (const line of block.lines) {
        if (line.text) {
          lines.push(line.text);
        }
      }
      lines.push(''); // 块间空行
    }
  }
  return lines.join('\n');
}

// 从 mammoth HTML 输出中提取表格，转为 Markdown 格式
function extractTablesFromHtml(html: string): string[] {
  const tables: string[] = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[1];
    const rows: string[][] = [];

    // 提取行
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
      const cells: string[] = [];
      const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRegex.exec(trMatch[1])!) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) continue;

    // 转为 Markdown table
    const colCount = Math.max(...rows.map(r => r.length));
    const normalized = rows.map(r => {
      while (r.length < colCount) r.push('');
      return r;
    });

    const mdRows = normalized.map(r => `| ${r.join(' | ')} |`);
    if (mdRows.length > 0) {
      // 第一行后加分隔线
      const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
      mdRows.splice(1, 0, separator);
      tables.push(mdRows.join('\n'));
    }
  }

  return tables;
}

export const loaderService = new LoaderService();
