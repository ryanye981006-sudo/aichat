// 文档处理并发控制队列
// 使用信号量模式，限制同时处理的文档数量
import { knowledgeService } from './KnowledgeService.js';

export class ProcessingQueue {
  private running = 0;
  private maxConcurrent: number;
  private queue: { docId: string; resolve: () => void; reject: (err: Error) => void }[] = [];
  private processingIds = new Set<string>();

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  // 入队处理
  async enqueue(docId: string): Promise<void> {
    // 防重复处理
    if (this.processingIds.has(docId)) return;

    if (this.running < this.maxConcurrent) {
      this.startProcessing(docId);
      return;
    }

    // 队列已满，等待
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ docId, resolve, reject });
    });
  }

  // 获取队列状态
  getStatus(): { processing: number; queued: number; maxConcurrent: number; processingIds: string[] } {
    return {
      processing: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      processingIds: Array.from(this.processingIds),
    };
  }

  // 启动处理
  private startProcessing(docId: string): void {
    this.running++;
    this.processingIds.add(docId);

    knowledgeService.processDocument(docId)
      .then(() => {
        this.onComplete(docId);
      })
      .catch((err: Error) => {
        console.error(`[ProcessingQueue] 文档 ${docId} 处理失败:`, err.message);
        this.onComplete(docId);
      });
  }

  // 处理完成
  private onComplete(docId: string): void {
    this.running--;
    this.processingIds.delete(docId);

    // 从队列取下一个
    this.dequeue();
  }

  // 调度下一个
  private dequeue(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.startProcessing(next.docId);
      // 通知入队者任务已开始
      next.resolve();
    }
  }
}

export const processingQueue = new ProcessingQueue();
