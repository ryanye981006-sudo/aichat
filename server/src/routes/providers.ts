import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { aiSdkService as aiService } from '../services/AiSdkService.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// 预设提供商
const DEFAULT_PROVIDERS = [
  { name: 'DeepSeek', type: 'OpenAI', base_url: 'https://api.deepseek.com/v1', is_preset: 1 },
  { name: '通义千问', type: 'OpenAI', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', is_preset: 1 },
  { name: '智谱 GLM', type: 'OpenAI', base_url: 'https://open.bigmodel.cn/api/paas/v4', is_preset: 1 },
  { name: 'Moonshot', type: 'OpenAI', base_url: 'https://api.moonshot.cn/v1', is_preset: 1 },
  { name: 'Ollama', type: 'Ollama', base_url: 'http://localhost:11434/v1', is_preset: 1 },
  { name: 'OpenAI', type: 'OpenAI', base_url: 'https://api.openai.com/v1', is_preset: 1 },
];

// 初始化预设提供商
function initPresets(): void {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as count FROM providers').get() as any;
  if (count.count === 0) {
    const insert = db.prepare(
      'INSERT INTO providers (id, name, type, base_url, api_key, is_preset, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const p of DEFAULT_PROVIDERS) {
      insert.run(uuidv4(), p.name, p.type, p.base_url, '', p.is_preset, 1);
    }
  }
}

// 获取所有提供商
router.get('/', (_req, res) => {
  initPresets();
  const db = getDb();
  const providers = db.prepare('SELECT * FROM providers ORDER BY is_preset ASC, created_at DESC').all();
  res.json(providers);
});

// 创建提供商
router.post('/', (req, res) => {
  const db = getDb();
  const { name, type, base_url, api_key } = req.body;
  if (!name) {
    return res.status(400).json({ error: '名称不能为空' });
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO providers (id, name, type, base_url, api_key, is_preset) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(id, name, type || 'OpenAI', base_url || '', api_key || '');

  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  res.status(201).json(provider);
});

// 更新提供商
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '提供商不存在' });
  }

  const fields = ['name', 'type', 'base_url', 'api_key', 'enabled'];
  const updates: string[] = [];
  const values: any[] = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'enabled') {
        values.push(req.body[field] ? 1 : 0);
      } else {
        values.push(req.body[field]);
      }
    }
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);
    db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  res.json(provider);
});

// 删除提供商
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    return res.status(404).json({ error: '提供商不存在' });
  }
  if (existing.is_preset) {
    return res.status(400).json({ error: '预设提供商不可删除' });
  }
  db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 测试提供商连接
router.post('/:id/test', async (req, res) => {
  try {
    await aiService.testConnection(req.params.id);
    res.json({ success: true, message: '连接成功' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 自动拉取模型列表
router.post('/:id/fetch-models', async (req, res) => {
  try {
    const models = await aiService.fetchModels(req.params.id);
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 清除供应商下所有模型
router.delete('/:id/models', (req, res) => {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  if (!provider) {
    return res.status(404).json({ error: '提供商不存在' });
  }
  db.prepare('DELETE FROM models WHERE provider_id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
