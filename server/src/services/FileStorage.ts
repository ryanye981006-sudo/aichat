// 文件上传存储服务
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

// 确保上传目录存在
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadsDir);
  },
  filename: (_req, file, cb) => {
    const originalName = fixFileNameEncoding(file.originalname);
    const ext = path.extname(originalName);
    const name = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, name);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

/**
 * 修复 multer/busboy Windows 编码问题：
 * Windows 上 multer 将 UTF-8 文件名按 Latin-1 解码导致中文乱码，
 * 通过 Latin-1 → UTF-8 重编码恢复原始 UTF-8 文件名。
 * 如果重编码产生替换字符（U+FFFD），说明原始文件名已是正确的 UTF-8，保留原值。
 */
export function fixFileNameEncoding(name: string): string {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (decoded.includes('�')) return name;
    return decoded;
  } catch {
    return name;
  }
}

export function getUploadPath(filename: string): string {
  return path.join(config.uploadsDir, filename);
}
