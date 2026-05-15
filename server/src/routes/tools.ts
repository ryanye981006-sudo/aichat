// 工具设置路由（嵌入模型配置、重排序模型配置）
import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

const PROFILE_KEYS = {
  embeddingApiUrl: 'embedding_api_url',
  embeddingApiKey: 'embedding_api_key',
  embeddingModelName: 'embedding_model_name',
  rerankerApiUrl: 'reranker_api_url',
  rerankerApiKey: 'reranker_api_key',
  rerankerModelName: 'reranker_model_name',
} as const;

function getProfileValue(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM user_profile WHERE key = ?').get(key) as any;
  return row?.value || '';
}

function setProfileValue(key: string, value: string) {
  const db = getDb();
  db.prepare(
    "INSERT INTO user_profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).run(key, value, value);
}

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length > 8) return `${key.slice(0, 4)}***${key.slice(-4)}`;
  return '***';
}

// ===== 嵌入模型配置 =====
router.get('/embedding-config', (_req, res) => {
  const apiKey = getProfileValue(PROFILE_KEYS.embeddingApiKey);
  res.json({
    apiUrl: getProfileValue(PROFILE_KEYS.embeddingApiUrl),
    apiKey: apiKey,
    apiKeyMasked: maskApiKey(apiKey),
    modelName: getProfileValue(PROFILE_KEYS.embeddingModelName),
  });
});

router.put('/embedding-config', (req, res) => {
  const { apiUrl, apiKey, modelName } = req.body;
  if (typeof apiUrl !== 'string' || typeof apiKey !== 'string' || typeof modelName !== 'string') {
    return res.status(400).json({ error: 'apiUrl, apiKey, modelName 为必填字符串' });
  }
  setProfileValue(PROFILE_KEYS.embeddingApiUrl, apiUrl);
  setProfileValue(PROFILE_KEYS.embeddingApiKey, apiKey);
  setProfileValue(PROFILE_KEYS.embeddingModelName, modelName);
  res.json({ success: true });
});

// ===== 重排序模型配置 =====
router.get('/reranker-config', (_req, res) => {
  const apiKey = getProfileValue(PROFILE_KEYS.rerankerApiKey);
  res.json({
    apiUrl: getProfileValue(PROFILE_KEYS.rerankerApiUrl),
    apiKey: apiKey,
    apiKeyMasked: maskApiKey(apiKey),
    modelName: getProfileValue(PROFILE_KEYS.rerankerModelName),
  });
});

router.put('/reranker-config', (req, res) => {
  const { apiUrl, apiKey, modelName } = req.body;
  if (typeof apiUrl !== 'string' || typeof apiKey !== 'string' || typeof modelName !== 'string') {
    return res.status(400).json({ error: 'apiUrl, apiKey, modelName 为必填字符串' });
  }
  setProfileValue(PROFILE_KEYS.rerankerApiUrl, apiUrl);
  setProfileValue(PROFILE_KEYS.rerankerApiKey, apiKey);
  setProfileValue(PROFILE_KEYS.rerankerModelName, modelName);
  res.json({ success: true });
});

export default router;
