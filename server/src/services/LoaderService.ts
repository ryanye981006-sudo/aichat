// 文档加载器：支持 PDF/Word/MD/TXT/URL
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export class LoaderService {
  async loadFile(filePath: string, mimeType: string): Promise<string> {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(config.uploadsDir, filePath);
    const ext = path.extname(fullPath).toLowerCase();

    switch (ext) {
      case '.txt':
      case '.md':
      case '.markdown':
        return fs.readFileSync(fullPath, 'utf-8');

      case '.pdf':
        return this.loadPdf(fullPath);

      case '.docx':
        return this.loadDocx(fullPath);

      case '.doc':
        throw new Error('暂不支持 .doc 格式，请转换为 .docx');

      default:
        // 尝试作为纯文本读取
        try {
          return fs.readFileSync(fullPath, 'utf-8');
        } catch {
          throw new Error(`不支持的文件格式: ${ext}`);
        }
    }
  }

  async loadUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`无法访问 URL (${response.status})`);
    }
    const html = await response.text();
    // 简单的 HTML 转文本
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async loadNote(content: string): Promise<string> {
    return content;
  }

  private async loadPdf(filePath: string): Promise<string> {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text;
    } catch (err) {
      throw new Error(`PDF 解析失败: ${(err as Error).message}`);
    }
  }

  private async loadDocx(filePath: string): Promise<string> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (err) {
      throw new Error(`Word 文档解析失败: ${(err as Error).message}`);
    }
  }
}

export const loaderService = new LoaderService();
