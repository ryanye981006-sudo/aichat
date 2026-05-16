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

// pet.json 完整结构（Codex Pet 格式）
export interface PetManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  sprite: PetSprite;
  animations: Record<string, PetAnimation>;
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
