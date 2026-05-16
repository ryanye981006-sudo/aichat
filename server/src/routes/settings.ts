// 全局设置路由（IQS API Key 等）
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { webSearchService } from '../services/WebSearchService.js';
import { IqsSearchProvider } from '../services/webSearch/IqsSearchProvider.js';
import { config } from '../config.js';

const router = Router();

// 获取 IQS Key 配置状态（不返回完整 Key，仅返回是否已配置）
// 检查优先级：user_profile DB → .env / config
router.get('/iqs-key', (_req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM user_profile WHERE key = 'iqs_api_key'").get() as any;
  // .env / config 中的 key 优先级更高（服务器级别配置）
  const envKey = config.iqsApiKey || '';
  const dbKey = row?.value || '';
  const effectiveKey = dbKey || envKey;
  const configured = !!(effectiveKey);
  const masked = effectiveKey.length > 8
    ? `${effectiveKey.slice(0, 4)}***${effectiveKey.slice(-4)}`
    : (effectiveKey ? '***' : '');
  res.json({ configured, masked, source: dbKey ? 'user_profile' : (envKey ? 'env' : null) });
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

// 测试 IQS Key 连通性
router.post('/iqs-key/test', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'apiKey 不能为空' });
  }
  try {
    const provider = new IqsSearchProvider(apiKey, config.iqsBaseUrl);
    const startTime = Date.now();
    await provider.search({ query: 'test', maxResults: 1 });
    res.json({ success: true, time: Date.now() - startTime });
  } catch (e) {
    res.json({ success: false, time: 0, error: (e as Error).message });
  }
});

export default router;
