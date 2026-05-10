// 全局设置路由（IQS API Key 等）
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { webSearchService } from '../services/WebSearchService.js';

const router = Router();

// 获取 IQS Key 配置状态（不返回完整 Key，仅返回是否已配置）
router.get('/iqs-key', (_req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM user_profile WHERE key = 'iqs_api_key'").get() as any;
  const configured = !!(row?.value);
  // 返回 Key 前4位 + 后4位 供前端识别
  const key = row?.value || '';
  const masked = key.length > 8 ? `${key.slice(0, 4)}***${key.slice(-4)}` : (key ? '***' : '');
  res.json({ configured, masked });
});

// 更新 IQS Key
router.put('/iqs-key', (req, res) => {
  const { apiKey } = req.body;
  if (typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey 不能为空' });
  }

  const db = getDb();
  db.prepare("INSERT INTO user_profile (key, value) VALUES ('iqs_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')").run(apiKey, apiKey);

  // 重建搜索引擎实例
  webSearchService.initFromConfig(apiKey);

  res.json({ success: true, configured: !!apiKey });
});

export default router;
