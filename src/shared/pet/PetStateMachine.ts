// 宠物状态机 — 6 核心状态 + 渐进式 idle 行为
import type { PetState, IdlePhase, PetEvent } from './types';

// 状态到 spritesheet 动画行的映射（遵循 Codex 9 行标准）
export const STATE_ANIMATION: Record<PetState, string> = {
  idle:      'idle',
  attention: 'waving',
  thinking:  'review',
  working:   'runningRight',  // TOOL_USE — 共用跑动动画
  success:   'jumping',
  error:     'failed',
  sleep:     'idle',          // 休眠复用 idle 但降帧率
};

export class PetStateMachine {
  private _state: PetState = 'idle';
  private _idlePhase: IdlePhase = 'active';
  private idleTimer = 0;         // ms
  private idleStartTime = 0;     // performance.now()
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null;

  // 渐进式 idle 时间阈值 (ms)
  private static readonly FIDGET_THRESHOLD = 30_000;    // 30s
  private static readonly DROWSY_THRESHOLD = 120_000;   // 2min
  private static readonly SLEEP_THRESHOLD = 300_000;    // 5min

  // 自动回到 idle 的超时 (ms)
  private static readonly SUCCESS_TIMEOUT = 3_500;
  private static readonly ERROR_TIMEOUT = 3_500;
  private autoResetTimer: ReturnType<typeof setTimeout> | null = null;

  get state(): PetState {
    return this._state;
  }

  get idlePhase(): IdlePhase {
    return this._idlePhase;
  }

  // 获取当前状态对应的动画名称（spritesheet 中的 key）
  getAnimation(): string {
    return STATE_ANIMATION[this._state] || 'idle';
  }

  // 启动渐进式 idle 计时器
  startIdleTimer(): void {
    this.idleStartTime = performance.now();
    this._idlePhase = 'active';

    this.idleCheckInterval = setInterval(() => {
      const elapsed = performance.now() - this.idleStartTime;

      if (elapsed >= PetStateMachine.SLEEP_THRESHOLD) {
        this._idlePhase = 'sleep';
        if (this._state === 'idle') {
          this._state = 'sleep';
        }
      } else if (elapsed >= PetStateMachine.DROWSY_THRESHOLD) {
        this._idlePhase = 'drowsy';
      } else if (elapsed >= PetStateMachine.FIDGET_THRESHOLD) {
        this._idlePhase = 'fidget';
      }
    }, 1000);
  }

  // 重置 idle 计时器（用户有交互时调用）
  resetIdleTimer(): void {
    if (this._state === 'sleep') {
      this._state = 'idle';
    }
    this.idleStartTime = performance.now();
    this._idlePhase = 'active';
  }

  // 处理状态事件，返回是否发生了状态转换
  transition(event: PetEvent): boolean {
    const prevState = this._state;

    // 重置 auto-reset 定时器
    if (this.autoResetTimer) {
      clearTimeout(this.autoResetTimer);
      this.autoResetTimer = null;
    }

    switch (event.type) {
      case 'session:user-input-start':
        this.resetIdleTimer();
        this._state = 'attention';
        break;

      case 'session:ai-thinking-start':
        this._state = 'thinking';
        break;

      case 'session:tool-call-start':
        this._state = 'working';
        break;

      case 'session:tool-call-end':
        // 工具调用结束，回到 thinking（可能有更多推理）
        this._state = 'thinking';
        break;

      case 'session:response-start':
        // 流式输出开始，保持 thinking 或切到 idle（看设计偏好）
        // 此处选择保持当前状态不切换，等 complete
        break;

      case 'session:response-complete':
        this._state = 'success';
        this.autoResetTimer = setTimeout(() => {
          if (this._state === 'success') {
            this._state = 'idle';
            this.startIdleTimer();
          }
        }, PetStateMachine.SUCCESS_TIMEOUT);
        break;

      case 'session:error':
        this._state = 'error';
        this.autoResetTimer = setTimeout(() => {
          if (this._state === 'error') {
            this._state = 'idle';
            this.startIdleTimer();
          }
        }, PetStateMachine.ERROR_TIMEOUT);
        break;

      case 'session:idle-timeout':
        this.startIdleTimer();
        break;
    }

    return prevState !== this._state;
  }

  // 清理资源
  destroy(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    if (this.autoResetTimer) {
      clearTimeout(this.autoResetTimer);
      this.autoResetTimer = null;
    }
  }
}
