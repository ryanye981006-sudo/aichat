// 桌宠资源 API — 供浏览器 dev 模式使用
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = Router();

// 宠物 ID 安全校验（仅允许字母数字、点、横线、下划线）
const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

function petsDir(): string {
  return path.join(os.homedir(), '.aichat', 'pets');
}

// 获取 spritesheet 文件名（pet.json 中指定或默认值）
function getSpritesheetName(petId: string): string {
  const manifestPath = path.join(petsDir(), petId, 'pet.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return manifest.spritesheetPath || manifest.sprite?.url || 'spritesheet.webp';
  }
  return 'spritesheet.webp';
}

// 列出已安装的宠物（含 spritesheet 预览 URL）
router.get('/', (_req, res) => {
  try {
    const dir = petsDir();
    if (!fs.existsSync(dir)) {
      return res.json([]);
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const pets = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(dir, entry.name, 'pet.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        pets.push({
          id: entry.name,
          name: manifest.displayName || manifest.id || manifest.name,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          installedAt: fs.statSync(manifestPath).mtime.toISOString(),
          spritesheetUrl: `/api/pets/${entry.name}/spritesheet`,
        });
      } catch {
        // 跳过损坏的
      }
    }
    res.json(pets.sort((a: any, b: any) => a.name.localeCompare(b.name)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 提供 spritesheet 图片（供设置页预览 + 桌面渲染器加载）
router.get('/:id/spritesheet', (req, res) => {
  try {
    const petId = req.params.id;
    if (!SAFE_ID.test(petId)) {
      return res.status(400).json({ error: '无效的宠物 ID' });
    }
    const ssName = getSpritesheetName(petId);
    const ssPath = path.join(petsDir(), petId, ssName);
    if (!fs.existsSync(ssPath)) {
      return res.status(404).json({ error: 'spritesheet 不存在' });
    }
    const ext = path.extname(ssName).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/webp';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(ssPath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
