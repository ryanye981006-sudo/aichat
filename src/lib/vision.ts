// 视觉模型检测工具 — 基于 Cherry Studio vision.ts 正则移植
// 用于文件上传时根据模型能力限制文件类型

import type { Model } from '../types';

// 获取模型的小写基准名称（去掉 provider 前缀）
function getBaseModelId(model: Pick<Model, 'id' | 'name'>): string {
  const id = model.id.toLowerCase();
  const lastSlash = id.lastIndexOf('/');
  return lastSlash >= 0 ? id.slice(lastSlash + 1) : id;
}

// ===== Vision 模型白名单（从 CherryStudio 移植）=====
const visionAllowedModels = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-3(?:\\.\\d)?-(?:flash|pro)(?:-preview)?',
  'gemini-(flash|pro|flash-lite)-latest',
  'gemini-exp',
  'claude-3',
  'claude-haiku-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3\\.[5-9](?:-[\\w-]+)?',
  'qwen2.5-omni',
  'qwen3-omni(?:-[\\w-]+)?',
  'qvq',
  'internvl2',
  'grok-vision-beta',
  'grok-4(?:-[\\w-]+)?',
  'pixtral',
  'gpt-4(?:-[\\w-]+)',
  'gpt-4.1(?:-[\\w-]+)?',
  'gpt-4o(?:-[\\w-]+)?',
  'gpt-4.5(?:-[\\w-]+)',
  'gpt-5(?:-[\\w-]+)?',
  'chatgpt-4o(?:-[\\w-]+)?',
  'o1(?:-[\\w-]+)?',
  'o3(?:-[\\w-]+)?',
  'o4(?:-[\\w-]+)?',
  'deepseek-vl(?:[\\w-]+)?',
  'kimi-k2\\.[56](?:-[\\w-]+)?',
  'kimi-latest',
  'gemma-?[3-4](?:[-.\\w]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-2[.-]0(?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  'gemma3(?:[-:\\w]+)?',
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?',
  'qwen-omni(?:-[\\w-]+)?',
  'mistral-large-(2512|latest)',
  'mistral-medium-(2508|latest)',
  'mistral-small',
  'mimo-v2\\.5$',
  'mimo-v2-omni(?:-[\\w-]+)?',
  'glm-5v-turbo',
];

// ===== Vision 模型黑名单（名字可能被白名单误匹配，但实际不支持 vision）=====
const visionExcludedModels = [
  'gpt-4-\\d+-preview',
  'gpt-4-turbo-preview',
  'gpt-4-32k',
  'gpt-4-\\d+',
  'o1-mini',
  'o3-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1',
];

const VISION_REGEX = new RegExp(
  `\\b(?!(?:${visionExcludedModels.join('|')})\\b)(${visionAllowedModels.join('|')})\\b`,
  'i'
);

// ===== 纯图片生成模型（从 CherryStudio 移植）=====
const DEDICATED_IMAGE_MODELS = [
  'dall-e(?:-[\\w-]+)?',
  'gpt-image(?:-[\\w-]+)?',
  'grok-2-image(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'flux(?:-[\\w-]+)?',
  'stable-?diffusion(?:-[\\w-]+)?',
  'stabilityai(?:-[\\w-]+)?',
  'sd-[\\w-]+',
  'sdxl(?:-[\\w-]+)?',
  'cogview(?:-[\\w-]+)?',
  'qwen-image(?:-[\\w-]+)?',
  'janus(?:-[\\w-]+)?',
  'midjourney(?:-[\\w-]+)?',
  'mj-[\\w-]+',
  'z-image(?:-[\\w-]+)?',
  'longcat-image(?:-[\\w-]+)?',
  'hunyuanimage(?:-[\\w-]+)?',
  'seedream(?:-[\\w-]+)?',
  'kandinsky(?:-[\\w-]+)?',
];

const DEDICATED_IMAGE_MODEL_REGEX = new RegExp(DEDICATED_IMAGE_MODELS.join('|'), 'i');

// ===== 图片增强模型（本身也是 vision 模型，额外支持图片编辑）=====
const IMAGE_ENHANCEMENT_MODELS = [
  'grok-2-image(?:-[\\w-]+)?',
  'qwen-image-edit',
  'gpt-image-1',
  'gpt-image-2',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-(?:flash|pro)-image(?:-[\\w-]+)?',
];

const IMAGE_ENHANCEMENT_MODELS_REGEX = new RegExp(IMAGE_ENHANCEMENT_MODELS.join('|'), 'i');

// 非视觉模型排除关键词
function isNonVisionModel(modelId: string): boolean {
  return (
    modelId.includes('embedding') ||
    modelId.includes('rerank')
  );
}

/**
 * 判断模型是否为视觉模型（支持图片输入）
 */
export function isVisionModel(model?: Pick<Model, 'id' | 'name'> | null): boolean {
  if (!model) return false;

  const modelId = getBaseModelId(model);
  if (isNonVisionModel(modelId)) return false;

  return VISION_REGEX.test(modelId) || IMAGE_ENHANCEMENT_MODELS_REGEX.test(modelId);
}

/**
 * 判断模型是否为纯图片生成模型（DALL-E 等，只能生成图片，不支持文本对话）
 */
export function isDedicatedImageModel(model?: Pick<Model, 'id' | 'name'> | null): boolean {
  if (!model) return false;
  const modelId = getBaseModelId(model);
  return DEDICATED_IMAGE_MODEL_REGEX.test(modelId);
}
