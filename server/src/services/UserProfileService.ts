// 用户个人信息管理：KV CRUD + 拼入 system prompt

import { getDb } from '../db/connection.js';
import type { UserProfileEntry } from '../types/index.js';

export class UserProfileService {
  // 获取全部个人信息
  getAll(): UserProfileEntry[] {
    const db = getDb();
    return db.prepare(
      'SELECT key, value, updated_at FROM user_profile ORDER BY key ASC'
    ).all() as UserProfileEntry[];
  }

  // 获取单条
  get(key: string): string | null {
    const db = getDb();
    const row = db.prepare(
      'SELECT value FROM user_profile WHERE key = ?'
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // 设置单条（upsert）
  set(key: string, value: string): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO user_profile (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  }

  // 删除单条
  delete(key: string): void {
    const db = getDb();
    db.prepare('DELETE FROM user_profile WHERE key = ?').run(key);
  }

  // 构建 system prompt 中的个人信息段落
  buildProfileSection(): string {
    const entries = this.getAll();
    if (entries.length === 0) return '';

    const lines = entries.map(e => `- ${e.key}: ${e.value}`);
    return `\n\n## 用户信息\n以下是用户主动声明的个人信息，请参考这些信息来个性化回复：\n${lines.join('\n')}`;
  }
}

export const userProfileService = new UserProfileService();
