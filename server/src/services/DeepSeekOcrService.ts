// DeepSeek-OCR 服务：通过硅基流动 Chat Completions 接口进行 OCR 识别
// 支持 PDF 直接输入和单张图片输入，替代 MinerU

import { config } from '../config.js';

export interface OcrResult {
  text: string;
}

export class DeepSeekOcrService {
  // PDF 直接输入（模型原生支持 application/pdf base64）
  async extractPdf(pdfBuffer: Buffer): Promise<OcrResult> {
    const base64 = pdfBuffer.toString('base64');
    const dataUrl = `data:application/pdf;base64,${base64}`;
    return this.callOcr(dataUrl);
  }

  // 单张图片 OCR（已 base64 编码的图片字符串，不含 data: 前缀）
  async extractImage(imageBase64: string, mimeType: string = 'image/png'): Promise<OcrResult> {
    const dataUrl = `data:${mimeType};base64,${imageBase64}`;
    return this.callOcr(dataUrl);
  }

  private async callOcr(dataUrl: string): Promise<OcrResult> {
    const response = await fetch(`${config.siliconflowBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.siliconflowApiKey}`,
      },
      body: JSON.stringify({
        model: config.ocrModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: config.ocrPrompt },
          ],
        }],
        max_tokens: 4096,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`DeepSeek-OCR 请求失败 (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string') {
      throw new Error(`DeepSeek-OCR 返回格式异常: ${JSON.stringify(data).slice(0, 300)}`);
    }

    return { text: content.trim() };
  }
}

export const deepSeekOcrService = new DeepSeekOcrService();
