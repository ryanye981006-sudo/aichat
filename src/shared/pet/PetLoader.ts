// pet.json 解析器 & 校验器 — 兼容 Codex Pet 社区格式 + 旧完整格式
import type { PetManifest, PetInstance } from './types';
import { DEFAULT_SPRITE, DEFAULT_ANIMATIONS } from './types';
import * as fs from 'fs';
import * as path from 'path';

// 校验 pet.json 结构合法性（兼容社区格式：sprite/animations 可选）
export function validateManifest(json: unknown): PetManifest {
  const m = json as Record<string, unknown>;
  console.log('[PetLoader] validateManifest: keys=' + Object.keys(m || {}).join(','));
  if (!m || typeof m !== 'object') {
    console.error('[PetLoader] pet.json 格式无效：不是合法的 JSON 对象');
    throw new Error('pet.json 格式无效：不是合法的 JSON 对象');
  }
  if (typeof m.displayName !== 'string') {
    console.error('[PetLoader] pet.json 缺少 displayName 字段');
    throw new Error('pet.json 缺少 displayName 字段');
  }
  // name 或 id 至少有一个
  if (typeof m.name !== 'string' && typeof m.id !== 'string') {
    console.error('[PetLoader] pet.json 缺少 name 或 id 字段');
    throw new Error('pet.json 缺少 name 或 id 字段');
  }

  // sprite 非必填，如存在则校验子字段
  const sprite = m.sprite as Record<string, unknown> | undefined;
  if (sprite) {
    if (typeof sprite.width !== 'number' || sprite.width < 1) {
      throw new Error('sprite.width 无效');
    }
    if (typeof sprite.height !== 'number' || sprite.height < 1) {
      throw new Error('sprite.height 无效');
    }
    if (typeof sprite.columns !== 'number' || sprite.columns < 1) {
      throw new Error('sprite.columns 无效');
    }
  }

  // animations 非必填，如存在则校验每个动画
  const animations = m.animations as Record<string, unknown> | undefined;
  if (animations) {
    for (const [animName, anim] of Object.entries(animations)) {
      const a = anim as Record<string, unknown>;
      if (typeof a.row !== 'number' || a.row < 0) {
        throw new Error(`动画 "${animName}" 的 row 无效`);
      }
      if (typeof a.frames !== 'number' || a.frames < 1) {
        throw new Error(`动画 "${animName}" 的 frames 无效`);
      }
    }
  }

  return json as PetManifest;
}

// 校验 spritesheet 尺寸是否符合声明
export function validateSpritesheet(
  spritesheetPath: string,
  _manifest: PetManifest,
): boolean {
  if (!fs.existsSync(spritesheetPath)) {
    throw new Error(`spritesheet 文件不存在: ${spritesheetPath}`);
  }
  const ext = path.extname(spritesheetPath).toLowerCase();
  if (ext !== '.webp' && ext !== '.png') {
    throw new Error(`spritesheet 格式不支持: ${ext}，需要 .webp 或 .png`);
  }
  return true;
}

// 从宠物目录加载完整宠物（社区格式缺失字段自动填充默认值）
export function loadPet(petDir: string): { manifest: PetManifest; spritesheetPath: string } {
  const manifestPath = path.join(petDir, 'pet.json');
  console.log('[PetLoader] loadPet: 目录=' + petDir + ', manifestPath=' + manifestPath);
  if (!fs.existsSync(manifestPath)) {
    console.error('[PetLoader] 找不到 pet.json: ' + manifestPath);
    throw new Error(`找不到 pet.json: ${manifestPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log('[PetLoader] pet.json 解析成功: displayName="' + (raw.displayName || '') + '", id="' + (raw.id || '') + '"');
  const manifest = validateManifest(raw);

  // 填充默认值（对齐 Codex 社区标准）
  if (!manifest.sprite) {
    console.log('[PetLoader] sprite 缺失，填充默认值');
    manifest.sprite = { ...DEFAULT_SPRITE };
    // 社区格式用 spritesheetPath 字段指定 spritesheet 文件名
    if (raw.spritesheetPath) {
      manifest.sprite.url = raw.spritesheetPath as string;
    }
  }
  if (!manifest.animations || Object.keys(manifest.animations).length === 0) {
    console.log('[PetLoader] animations 缺失，填充默认值');
    manifest.animations = { ...DEFAULT_ANIMATIONS };
  }

  const spritesheetPath = path.join(petDir, manifest.sprite.url);
  console.log('[PetLoader] spritesheetPath=' + spritesheetPath);
  validateSpritesheet(spritesheetPath, manifest);

  return { manifest, spritesheetPath };
}

// 扫描宠物目录，返回已安装列表
export function listInstalledPets(baseDir: string): PetInstance[] {
  console.log('[PetLoader] listInstalledPets: baseDir=' + baseDir);
  if (!fs.existsSync(baseDir)) {
    console.log('[PetLoader] 目录不存在: ' + baseDir);
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
        name: manifest.displayName || manifest.id || manifest.name || entry.name,
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
