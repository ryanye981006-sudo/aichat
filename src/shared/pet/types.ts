// 桌宠共享类型定义 — 供前端、Electron、设置页共用

// 单行动画配置（对应 pet.json animations 中的一项）
export interface PetAnimation {
  row: number;       // spritesheet 行号 (0-indexed)
  frames: number;    // 该行动画帧数
  fps: number;       // 播放帧率
}

// spritesheet 元数据
export interface PetSprite {
  url: string;       // spritesheet 文件名
  width: number;     // 单帧宽度 (px)
  height: number;    // 单帧高度 (px)
  columns: number;   // 列数（通常为 8）
  rows: number;      // 行数（通常为 9）
}

// Codex 社区标准默认精灵配置（1536×1872 spritesheet, 8×9 grid）
export const DEFAULT_SPRITE: PetSprite = {
  url: 'spritesheet.webp',
  width: 192,
  height: 208,
  columns: 8,
  rows: 9,
};

// Codex 社区标准默认动画行映射（帧数按社区素材实际帧数）
export const DEFAULT_ANIMATIONS: Record<string, PetAnimation> = {
  idle:         { row: 0, frames: 6, fps: 6 },
  runningRight: { row: 1, frames: 8, fps: 8 },
  runningLeft:  { row: 2, frames: 8, fps: 8 },
  waving:       { row: 3, frames: 4, fps: 6 },
  jumping:      { row: 4, frames: 5, fps: 7 },
  failed:       { row: 5, frames: 8, fps: 7 },
  grab:         { row: 6, frames: 6, fps: 6 },
  grabbing:     { row: 7, frames: 6, fps: 8 },
  review:       { row: 8, frames: 6, fps: 6 },
};

// pet.json 完整结构（兼容 Codex 社区格式）
export interface PetManifest {
  name?: string;       // 旧格式标识
  id?: string;         // 社区格式标识（社区 pet.json 使用 id 而非 name）
  displayName: string;
  description?: string;
  version?: string;
  spritesheetPath?: string;   // 社区格式 spritesheet 文件名
  sprite?: PetSprite;         // 可选：缺失时使用 DEFAULT_SPRITE
  animations?: Record<string, PetAnimation>;  // 可选：缺失时使用 DEFAULT_ANIMATIONS
  author?: string;
  tags?: string[];
  source?: string;
  sourceUrl?: string;
}

// 宠物运行时状态
export type PetState =
  | 'idle'
  | 'attention'
  | 'thinking'
  | 'working'    // 工具调用中
  | 'success'
  | 'error'
  | 'sleep';      // 休眠（5min 无交互后触发）

// 宠物运行时描述
export interface PetInstance {
  id: string;            // 目录名 = 宠物唯一 ID
  name: string;          // displayName
  path: string;          // 宠物目录绝对路径
  manifest: PetManifest; // 已解析的 pet.json
  isActive: boolean;     // 是否为当前启用的宠物
  installedAt: string;   // 安装时间 ISO
}

// 后端 emit 的事件结构
export interface PetEvent {
  type: string;          // e.g. 'session:user-input-start'
  payload: PetEventPayload;
  timestamp: number;
}

export interface PetEventPayload {
  sessionId?: string;
  assistantName?: string;
  messageLength?: number;
  toolName?: string;
  toolDuration?: number;
  tokens?: number;
  duration?: number;
  message?: string;      // error message
}

// 渐进式 idle 阶段
export type IdlePhase = 'active' | 'fidget' | 'drowsy' | 'sleep';

// 宠物交互动作（宠物窗口 → 主进程）
export interface PetAction {
  type: 'double-click' | 'right-click' | 'menu-action' | 'drag-end' | 'file-drop';
  payload?: unknown;
}

// pet-config.json 持久化配置
export interface PetConfig {
  defaultPetId: string | null;
  zoom: number;          // 0.5 ~ 2.0
  position: 'bottom-right' | 'bottom-left' | 'custom';
  customPosition: { x: number; y: number } | null;
  autoWakeOnStartup: boolean;
}

export const DEFAULT_PET_CONFIG: PetConfig = {
  defaultPetId: null,
  zoom: 1.0,
  position: 'bottom-right',
  customPosition: null,
  autoWakeOnStartup: true,
};
