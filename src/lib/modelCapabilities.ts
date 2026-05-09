// 模型能力检测 — 根据模型视觉/图片生成能力限制文件上传类型
// 参考 CherryStudio Inputbar.tsx 中的 canAddImageFile / canAddTextFile / supportedExts

import type { Model } from '../types';
import { isVisionModel, isDedicatedImageModel } from './vision';

// 文件扩展名分类（参考 CherryStudio packages/shared/config/constant.ts）
export const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
export const documentExts = ['.pdf', '.doc', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods'];
export const textExts = ['.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.yaml', '.yml',
  '.log', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rs', '.go', '.rb', '.php', '.swift', '.kt', '.scala', '.sh', '.bash', '.zsh',
  '.sql', '.html', '.css', '.scss', '.less', '.toml', '.ini', '.cfg', '.conf',
];

// 文件大类
export type FileCategory = 'image' | 'document' | 'text';

/**
 * 根据文件扩展名判断文件大类
 */
export function getFileCategory(ext: string): FileCategory {
  const lower = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  if (imageExts.includes(lower)) return 'image';
  if (documentExts.includes(lower)) return 'document';
  return 'text';
}

/**
 * 根据模型能力判断是否可以添加图片文件
 * - Vision 模型: 可以
 * - 图片生成模型: 可以
 * - 普通文本模型: 不可以
 */
export function canAddImageFile(model?: Model | null): boolean {
  if (!model) return true; // 无模型时默认允许
  return isVisionModel(model) || isDedicatedImageModel(model);
}

/**
 * 根据模型能力判断是否可以添加文本/文档文件
 * - 纯图片生成模型: 不可以（它们只能接收图片输入）
 * - 其他模型: 可以
 */
export function canAddDocumentFile(model?: Model | null): boolean {
  if (!model) return true;
  // 纯图片生成模型且非 vision 模型 → 不能添加文档
  if (isDedicatedImageModel(model) && !isVisionModel(model)) return false;
  return true;
}

/**
 * 根据模型能力计算允许的文件扩展名列表
 * 用途：input[type=file] 的 accept 属性、拖放/粘贴过滤
 */
export function getSupportedExts(model?: Model | null): string[] {
  if (!model) return [...imageExts, ...documentExts, ...textExts];

  const vision = canAddImageFile(model);
  const doc = canAddDocumentFile(model);

  if (vision && doc) return [...imageExts, ...documentExts, ...textExts];
  if (vision) return [...imageExts];
  if (doc) return [...documentExts, ...textExts];
  return [];
}

/**
 * 检查文件是否被当前模型支持
 * 返回 null 表示通过，否则返回拒绝原因字符串
 */
export function checkFileAllowed(ext: string, model?: Model | null): string | null {
  const category = getFileCategory(ext);

  if (category === 'image' && !canAddImageFile(model)) {
    return '当前模型不支持视觉能力，无法上传图片';
  }
  if ((category === 'document' || category === 'text') && !canAddDocumentFile(model)) {
    return '当前模型为纯图片生成模型，不支持文档/文本文件';
  }

  return null;
}
