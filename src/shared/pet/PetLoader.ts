// pet.json 解析器 & 校验器 — 兼容 Codex Pet 格式
import type { PetManifest, PetInstance } from './types';
import * as fs from 'fs';
import * as path from 'path';

// 校验 pet.json 结构合法性
export function validateManifest(json: unknown): PetManifest {
  const m = json as Record<string, unknown>;
  if (!m || typeof m !== 'object') {
    throw new Error('pet.json 格式无效：不是合法的 JSON 对象');
  }
  if (typeof m.name !== 'string') {
    throw new Error('pet.json 缺少 name 字段');
  }
  if (typeof m.displayName !== 'string') {
    throw new Error('pet.json 缺少 displayName 字段');
  }

  const sprite = m.sprite as Record<string, unknown> | undefined;
  if (!sprite || typeof sprite !== 'object') {
    throw new Error('pet.json 缺少 sprite 元数据');
  }
  if (typeof sprite.width !== 'number' || sprite.width < 1) {
    throw new Error('sprite.width 无效');
  }
  if (typeof sprite.height !== 'number' || sprite.height < 1) {
    throw new Error('sprite.height 无效');
  }
  if (typeof sprite.columns !== 'number' || sprite.columns < 1) {
    throw new Error('sprite.columns 无效');
  }

  const animations = m.animations as Record<string, unknown> | undefined;
  if (!animations || typeof animations !== 'object' || !animations.idle) {
    throw new Error('pet.json 必须至少包含 idle 动画');
  }

  // 校验每个动画配置
  for (const [name, anim] of Object.entries(animations)) {
    const a = anim as Record<string, unknown>;
    if (typeof a.row !== 'number' || a.row < 0) {
      throw new Error(`动画 "${name}" 的 row 无效`);
    }
    if (typeof a.frames !== 'number' || a.frames < 1) {
      throw new Error(`动画 "${name}" 的 frames 无效`);
    }
  }

  return json as PetManifest;
}

// 校验 spritesheet 尺寸是否符合声明
export function validateSpritesheet(
  spritesheetPath: string,
  manifest: PetManifest,
): boolean {
  if (!fs.existsSync(spritesheetPath)) {
    throw new Error(`spritesheet 文件不存在: ${spritesheetPath}`);
  }
  const ext = path.extname(spritesheetPath).toLowerCase();
  if (ext !== '.webp' && ext !== '.png') {
    throw new Error(`spritesheet 格式不支持: ${ext}，需要 .webp 或 .png`);
  }
  // 尺寸校验在浏览器端进行（Node.js 无法读取图片尺寸）
  return true;
}

// 从宠物目录加载完整宠物
export function loadPet(petDir: string): { manifest: PetManifest; spritesheetPath: string } {
  const manifestPath = path.join(petDir, 'pet.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`找不到 pet.json: ${manifestPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const manifest = validateManifest(raw);

  const spritesheetPath = path.join(petDir, manifest.sprite.url || 'spritesheet.webp');
  validateSpritesheet(spritesheetPath, manifest);

  return { manifest, spritesheetPath };
}

// 扫描宠物目录，返回已安装列表
export function listInstalledPets(baseDir: string): PetInstance[] {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const pets: PetInstance[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const petDir = path.join(baseDir, entry.name);
    const manifestPath = path.join(petDir, 'pet.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const { manifest } = loadPet(petDir);
      const stat = fs.statSync(manifestPath);
      pets.push({
        id: entry.name,
        name: manifest.displayName || manifest.name,
        path: petDir,
        manifest,
        isActive: false,
        installedAt: stat.mtime.toISOString(),
      });
    } catch {
      // 跳过损坏的宠物目录
    }
  }

  return pets.sort((a, b) => a.name.localeCompare(b.name));
}

// 获取宠物目录的基础路径
export function getPetsBaseDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '~';
  return path.join(home, '.aichat', 'pets');
}
