// 用户个人信息 CRUD API

import { Router, Request, Response } from 'express';
import { userProfileService } from '../services/UserProfileService.js';

const router = Router();

// 获取全部个人信息
router.get('/', (_req: Request, res: Response) => {
  const entries = userProfileService.getAll();
  res.json(entries);
});

// 批量更新个人信息
router.put('/', (req: Request, res: Response) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    res.status(400).json({ error: '请求体必须为 { key: value } 对象' });
    return;
  }

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.trim()) {
      userProfileService.set(key, value.trim());
    } else if (value === '' || value === null) {
      userProfileService.delete(key);
    }
  }

  const entries = userProfileService.getAll();
  res.json(entries);
});

// 删除单条个人信息
router.delete('/:key', (req: Request, res: Response) => {
  const { key } = req.params;
  userProfileService.delete(key);
  res.json({ success: true });
});

export default router;
