// 触发 B：定时扫描空闲超过阈值的会话，强制闭合 chunk 并触发记忆提取

import { conversationChunkService } from './ConversationChunkService.js';
import { config } from '../config.js';

export class ConversationIdleDetector {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;

    // 每 15 分钟扫描一次
    const intervalMs = 15 * 60 * 1000;
    this.timer = setInterval(() => {
      conversationChunkService.processStaleConversations(config.sessionIdleTimeoutMs)
        .catch(err => console.error('[IdleDetector] 扫描失败:', err));
    }, intervalMs);

    console.log(`[IdleDetector] 已启动，扫描间隔 ${intervalMs / 60000} 分钟，空闲阈值 ${config.sessionIdleTimeoutMs / 60000} 分钟`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[IdleDetector] 已停止');
    }
  }
}

export const conversationIdleDetector = new ConversationIdleDetector();
