// 桌宠事件总线 — 通过 stdout JSON 行协议与 Electron 主进程通信
import { EventEmitter } from 'events';

export const petEventBus = new EventEmitter();

// 通过 stdout 输出 JSON 事件（Electron 主进程解析 PET_EVENT: 前缀的行）
function emitPetEvent(event: { type: string; payload: Record<string, unknown> }) {
  // 本地 emit（同进程内的监听器可用）
  petEventBus.emit(event.type, event);
  // 输出到 stdout 供 Electron 主进程捕获
  const line = `PET_EVENT:${JSON.stringify({ ...event, timestamp: Date.now() })}\n`;
  process.stdout.write(line);
}

// 各个事件的便捷 emit 函数
export function emitUserInputStart(sessionId: string, assistantName: string, messageLength: number) {
  emitPetEvent({
    type: 'session:user-input-start',
    payload: { sessionId, assistantName, messageLength },
  });
}

export function emitAiThinkingStart(sessionId: string) {
  emitPetEvent({
    type: 'session:ai-thinking-start',
    payload: { sessionId },
  });
}

export function emitResponseStart(sessionId: string) {
  emitPetEvent({
    type: 'session:response-start',
    payload: { sessionId },
  });
}

export function emitResponseComplete(sessionId: string, tokens: number, duration: number) {
  emitPetEvent({
    type: 'session:response-complete',
    payload: { sessionId, tokens, duration },
  });
}

export function emitError(sessionId: string, message: string) {
  emitPetEvent({
    type: 'session:error',
    payload: { sessionId, message },
  });
}

export function emitToolCallStart(sessionId: string, toolName: string) {
  emitPetEvent({
    type: 'session:tool-call-start',
    payload: { sessionId, toolName },
  });
}

export function emitToolCallEnd(sessionId: string, toolName: string, toolDuration?: number) {
  emitPetEvent({
    type: 'session:tool-call-end',
    payload: { sessionId, toolName, toolDuration },
  });
}
