// Canvas 2D 精灵图渲染引擎 — 逐帧播放 spritesheet 动画
import type { PetManifest, PetAnimation, PetSprite } from './types';
import { DEFAULT_SPRITE, DEFAULT_ANIMATIONS } from './types';

export interface PlayOptions {
  loop?: boolean;       // 是否循环播放，默认 true
  onComplete?: () => void; // 单次播放完成回调
}

export class SpriteRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private spritesheet: HTMLImageElement;
  private manifest: PetManifest;
  private scale: number;

  private currentAnim: PetAnimation | null = null;
  private currentRow = 0;
  private currentFrame = 0;
  private frameTimer = 0;
  private animFrameId = 0;
  private isRunning = false;
  private loop = true;
  private onComplete: (() => void) | null = null;

  // 像素 alpha 缓存（用于点击穿透检测）
  private alphaMap: Uint8Array | null = null;
  private alphaMapScale = 1;

  constructor(
    canvas: HTMLCanvasElement,
    spritesheet: HTMLImageElement,
    manifest: PetManifest,
    scale: number,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.spritesheet = spritesheet;
    this.manifest = manifest;
    this.scale = scale;

    this.resizeCanvas();
  }

  // 获取 sprite 配置（缺失时回退到 Codex 社区默认值）
  private getSprite(): PetSprite {
    return this.manifest.sprite || DEFAULT_SPRITE;
  }

  // 获取 animations 配置（缺失时回退到 Codex 社区默认值）
  private getAnimations(): Record<string, PetAnimation> {
    return this.manifest.animations || DEFAULT_ANIMATIONS;
  }

  // 缩放窗口尺寸
  private resizeCanvas(): void {
    const { width, height } = this.getSprite();
    this.canvas.width = Math.round(width * this.scale);
    this.canvas.height = Math.round(height * this.scale);
  }

  // 播放指定状态的动画
  play(state: string, options: PlayOptions = {}): void {
    const anims = this.getAnimations();
    const anim = anims[state];
    if (!anim) {
      // 未知状态回退到 idle
      const idleAnim = anims['idle'];
      if (idleAnim) {
        return this.play('idle', options);
      }
      return;
    }

    // 相同动画不重启
    if (this.currentRow === anim.row && this.currentAnim?.row === anim.row && this.isRunning) {
      this.loop = options.loop ?? true;
      this.onComplete = options.onComplete ?? null;
      return;
    }

    this.currentAnim = anim;
    this.currentRow = anim.row;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.loop = options.loop ?? true;
    this.onComplete = options.onComplete ?? null;

    if (!this.isRunning) {
      this.start();
    }
  }

  // 设置缩放
  setScale(s: number): void {
    this.scale = Math.max(0.5, Math.min(2.0, s));
    this.resizeCanvas();
    this.alphaMap = null; // 缩放变化后清空 alpha 缓存
  }

  // 获取当前缩放
  getScale(): number {
    return this.scale;
  }

  // 获取当前帧索引
  getCurrentFrame(): number {
    return this.currentFrame;
  }

  // 启动渲染循环
  private start(): void {
    this.isRunning = true;
    let lastTime = performance.now();

    const tick = (now: number) => {
      if (!this.isRunning) return;

      const delta = now - lastTime;
      lastTime = now;

      if (this.currentAnim) {
        const fps = this.currentAnim.fps || 6;
        const frameInterval = 1000 / fps;
        this.frameTimer += delta;

        if (this.frameTimer >= frameInterval) {
          this.frameTimer -= frameInterval;
          this.currentFrame++;

          if (this.currentFrame >= this.currentAnim.frames) {
            if (this.loop) {
              this.currentFrame = 0;
            } else {
              this.currentFrame = this.currentAnim.frames - 1;
              this.onComplete?.();
              this.isRunning = false;
              return;
            }
          }
        }

        this.drawFrame();
      }

      this.animFrameId = requestAnimationFrame(tick);
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  // 绘制当前帧
  private drawFrame(): void {
    if (!this.currentAnim) return;

    const { width, height, columns } = this.getSprite();
    const col = this.currentFrame % columns;
    const row = this.currentRow;

    const sx = col * width;
    const sy = row * height;
    const dw = Math.round(width * this.scale);
    const dh = Math.round(height * this.scale);

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(
      this.spritesheet,
      sx, sy, width, height,    // 源裁剪矩形
      0, 0, dw, dh,             // 目标绘制矩形
    );
  }

  // 检测指定坐标是否为非透明像素
  isOpaquePixel(canvasX: number, canvasY: number): boolean {
    const x = Math.floor(canvasX / this.scale);
    const y = Math.floor(canvasY / this.scale);
    const sprite = this.getSprite();

    if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) {
      return false;
    }

    // 延迟初始化 alpha 缓存
    if (!this.alphaMap) {
      this.buildAlphaMap();
    }

    if (this.alphaMap) {
      const idx = y * sprite.width + x;
      return idx < this.alphaMap.length && this.alphaMap[idx] > 30;
    }

    // 回退：直接从 Canvas 读取像素
    const pixel = this.ctx.getImageData(canvasX, canvasY, 1, 1);
    return pixel.data[3] > 30;
  }

  private buildAlphaMap(): void {
    const sprite = this.getSprite();
    // 在离屏 canvas 上绘制第一帧以提取 alpha
    const offscreen = document.createElement('canvas');
    offscreen.width = sprite.width;
    offscreen.height = sprite.height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    offCtx.drawImage(this.spritesheet, 0, 0);
    const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    // 仅提取 alpha 通道
    if (imageData.data.length > 0) {
      this.alphaMap = new Uint8Array(imageData.data.length / 4);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const alpha = imageData.data[i + 3];
        if (alpha !== undefined) {
          this.alphaMap[i / 4] = alpha;
        }
      }
    }
  }

  // 停止渲染并清理资源
  destroy(): void {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.alphaMap = null;
  }
}
