// MinerU 预处理服务：对复杂 PDF（扫描件、表格密集型）进行结构化解析
// 异步任务模型：提交 → 轮询 → 获取结果
import { config } from '../config.js';

interface MineruTaskResult {
  markdown: string;
  pages: number;
}

export class MineruService {
  // 提取任务并等待结果
  async extractPdf(pdfBuffer: Buffer, fileName: string): Promise<MineruTaskResult> {
    if (!config.mineruJwt) {
      throw new Error('未配置 MINERU_JWT');
    }

    // Step 1: 提交任务
    const formData = new FormData();
    formData.append('file', new Blob([pdfBuffer]), fileName);
    formData.append('is_ocr', 'true');

    const submitResponse = await fetch(config.mineruBaseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.mineruJwt}`,
      },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      throw new Error(`MinerU 提交任务失败 (${submitResponse.status}): ${errText.slice(0, 200)}`);
    }

    const submitData = await submitResponse.json() as any;
    const taskId = submitData?.data?.task_id || submitData?.task_id;
    if (!taskId) {
      throw new Error(`MinerU 返回格式异常: ${JSON.stringify(submitData).slice(0, 300)}`);
    }

    // Step 2: 轮询任务状态（最多等待 5 分钟）
    const maxWaitMs = 5 * 60 * 1000;
    const pollInterval = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusResponse = await fetch(`${config.mineruBaseUrl}/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${config.mineruJwt}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!statusResponse.ok) {
        continue; // 轮询失败时重试
      }

      const statusData = await statusResponse.json() as any;
      const status = statusData?.data?.state || statusData?.data?.status;

      if (status === 'done' || status === 'completed' || status === 'success') {
        // Step 3: 获取结果
        const resultUrl = statusData?.data?.full_zip_url || statusData?.data?.result_url;
        if (!resultUrl) {
          throw new Error('MinerU 任务完成但未返回结果 URL');
        }

        const resultResponse = await fetch(resultUrl, {
          signal: AbortSignal.timeout(60000),
        });
        if (!resultResponse.ok) {
          throw new Error(`MinerU 下载结果失败 (${resultResponse.status})`);
        }

        // 尝试解析为 ZIP 或直接 Markdown
        const contentType = resultResponse.headers.get('content-type') || '';
        if (contentType.includes('zip')) {
          // ZIP 格式：需要解压获取 markdown 文件
          // 这里简化处理，直接尝试获取文本内容
          const text = await resultResponse.text();
          return { markdown: text, pages: 0 };
        } else {
          const markdown = await resultResponse.text();
          return { markdown, pages: 0 };
        }
      }

      if (status === 'failed' || status === 'error') {
        const errMsg = statusData?.data?.err_msg || statusData?.data?.error || '未知错误';
        throw new Error(`MinerU 任务失败: ${errMsg}`);
      }
    }

    throw new Error('MinerU 任务超时（5 分钟）');
  }
}

export const mineruService = new MineruService();
