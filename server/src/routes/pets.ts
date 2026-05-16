// 桌宠资源 API — 供浏览器 dev 模式使用
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = Router();

function petsDir(): string {
  return path.join(os.homedir(), '.aichat', 'pets');
}

// 列出已安装的宠物
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
          name: manifest.displayName || manifest.name,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          installedAt: fs.statSync(manifestPath).mtime.toISOString(),
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

export default router;
