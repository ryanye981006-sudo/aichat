// 推理模型检测工具 — 基于正则匹配模型族，参考 Cherry Studio 实现

import type { Model } from '../types';

// 获取模型的小写基准名称（去掉 provider 前缀和日期后缀）
function getBaseModelId(model: { id: string; name?: string }): string {
  const id = model.id.toLowerCase();
  // 去掉路径中的 provider 前缀（deepseek/deepseek-chat → deepseek-chat）
  const lastSlash = id.lastIndexOf('/');
  return lastSlash >= 0 ? id.slice(lastSlash + 1) : id;
}

// 全局推理模型正则 —— 自动捕获大部分 reasoning 模型
// 覆盖：o-series、带 reasoning/thinking/think 关键词、qwq/qvq、hunyuan-t1、
//       glm-zero、grok-3/grok-4、deepseek-r1 等
export const REASONING_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bqvq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast)(?:-[\w-]+)?\b.*)$/i;

// 支持思考控制的模型正则 — 可通过 thinking token 或 reasoning_effort 开关
// DeepSeek V3/V4/Chat、Qwen3/Qwen3.5+、Claude 3.7/4.x、GPT-5、Gemini 2.5+/3.x、
// Kimi K2+、MiniMax M1/M2+、Hunyuan A13B、GLM-4.5+、Mistral Small 2603、Gemma 4、ByteDance Seed 等
const SUPPORTED_THINKING_CONTROL_REGEX =
  /(?:deepseek-(?:chat|v3|v4|v5)|qwen3(?:\.\d+)?(?:-(?!coder|asr|tts|reranker|embedding|instruct)[\w-]+)?|claude-(?:sonnet|opus|haiku)-(?:3[.-]7|4)|claude-(?:sonnet|opus|haiku)-4[.-][56]|gpt-5|gemini-(?:2\.[5-9]|3)(?:-[\w-]+)*|kimi-k2(?:\.\d+)?|minimax-m[12]|hunyuan-a13b|glm-zero|glm-?4\.[567]|glm-?5|mistral-small-2603|gemma-?4|doubao-seed-1[.-][68]|doubao-1-5-thinking|seed-oss|pangu-pro-moe)/i;

// GPT o-series / GPT-5 系列
function isOpenAIReasoningModel(modelId: string): boolean {
  return (
    /^o\d+(?:-[\w-]+)*$/i.test(modelId) ||
    modelId.includes('gpt-5') ||
    modelId.includes('o3') ||
    modelId.includes('o4')
  );
}

// DeepSeek 推理模型
function isDeepSeekReasoningModel(modelId: string): boolean {
  return (
    modelId.includes('deepseek-r1') ||
    modelId.includes('deepseek-reasoner') ||
    /(\w+-)?deepseek-v[3-9]/.test(modelId) ||
    modelId.includes('deepseek-chat')
  );
}

// Qwen 推理模型
function isQwenReasoningModel(modelId: string): boolean {
  if (modelId.includes('qwq') || modelId.includes('qvq')) return true;
  if (modelId.startsWith('qwen3') && modelId.includes('thinking')) return true;
  if (/^qwen3\.[5-9]/.test(modelId)) return true;
  // qwen3-max/plus/flash/turbo 系列
  if (/^qwen3-(?:max|plus|flash|turbo)/.test(modelId)) return true;
  if (/^qwen(?:3\.\d+)?-(?:max|plus|flash|turbo)/.test(modelId)) return true;
  if (/^qwen3-\d/.test(modelId)) return true; // open-weight qwen3-8b 等
  return false;
}

// Claude 推理模型
function isClaudeReasoningModel(modelId: string): boolean {
  return (
    modelId.includes('claude-3-7-sonnet') ||
    modelId.includes('claude-3.7-sonnet') ||
    modelId.includes('claude-sonnet-4') ||
    modelId.includes('claude-opus-4') ||
    modelId.includes('claude-haiku-4')
  );
}

// Gemini 推理模型
function isGeminiReasoningModel(modelId: string): boolean {
  if (modelId.startsWith('gemini') && modelId.includes('thinking')) return true;
  return /gemini-(?:2\.[5-9]|3)/.test(modelId);
}

// Grok 推理模型
function isGrokReasoningModel(modelId: string): boolean {
  if (modelId.includes('grok-3-mini')) return true;
  return modelId.includes('grok-4') && !modelId.includes('non-reasoning');
}

// 其他推理模型
function isOtherReasoningModel(modelId: string): boolean {
  return (
    modelId.includes('hunyuan-t1') ||
    modelId.includes('hunyuan-a13b') ||
    modelId.includes('glm-zero') ||
    modelId.includes('glm-z1') ||
    modelId.includes('kimi-k2') ||
    modelId.includes('minimax-m1') ||
    modelId.includes('minimax-m2') ||
    modelId.includes('mistral-small-2603') ||
    modelId.includes('magistral') ||
    modelId.includes('pangu-pro-moe') ||
    modelId.includes('seed-oss') ||
    modelId.includes('gemma-4') ||
    modelId.includes('gemma4') ||
    modelId.includes('step-3') ||
    modelId.includes('step-r1') ||
    modelId.includes('mimo-v2') ||
    modelId.includes('baichuan-m2') ||
    modelId.includes('baichuan-m3') ||
    modelId.includes('ring-1t') ||
    modelId.includes('ring-mini') ||
    modelId.includes('ring-flash')
  );
}

// 非推理模型排除（embedding、rerank、文生图等）
function isNonReasoningModel(modelId: string): boolean {
  return (
    modelId.includes('embedding') ||
    modelId.includes('rerank') ||
    modelId.includes('tts') ||
    modelId.includes('asr') ||
    modelId.includes('dall-e') ||
    modelId.includes('image') ||
    modelId.includes('imagen')
  );
}

/**
 * 判断模型是否为推理模型（支持深度思考）
 * 先检查模型 name，再检查模型 id，满足任一即视为推理模型
 */
export function isReasoningModel(model?: Pick<Model, 'id' | 'name'> | null): boolean {
  if (!model) return false;

  const modelId = getBaseModelId(model);
  const modelName = model.name?.toLowerCase() || '';

  if (isNonReasoningModel(modelId)) return false;

  const checkId = (id: string): boolean => {
    return (
      REASONING_REGEX.test(id) ||
      isDeepSeekReasoningModel(id) ||
      isQwenReasoningModel(id) ||
      isClaudeReasoningModel(id) ||
      isGeminiReasoningModel(id) ||
      isGrokReasoningModel(id) ||
      isOpenAIReasoningModel(id) ||
      isOtherReasoningModel(id)
    );
  };

  return checkId(modelId) || checkId(modelName);
}

/**
 * 判断模型是否支持思考控制（可主动开启/关闭深度思考）
 * 不支持控制的推理模型（如 deepseek-r1）始终输出思考过程，无法关闭
 */
export function supportsThinkingControl(model?: Pick<Model, 'id' | 'name'> | null): boolean {
  if (!model) return false;

  const modelId = getBaseModelId(model);
  const modelName = model.name?.toLowerCase() || '';

  if (isNonReasoningModel(modelId)) return false;

  const checkId = (id: string): boolean => {
    // DeepSeek R1 始终思考，不可控
    if (id.includes('deepseek-r1') || id.includes('deepseek-reasoner')) return false;
    // Qwen thinking 模型始终思考
    if (id.startsWith('qwen3') && id.includes('thinking')) return false;
    if (id.includes('qwq') || id.includes('qvq')) return false;
    // Hunyuan T1 始终思考
    if (id.includes('hunyuan-t1')) return false;
    // GLM Zero 始终思考
    if (id.includes('glm-zero')) return false;

    return SUPPORTED_THINKING_CONTROL_REGEX.test(id);
  };

  return checkId(modelId) || checkId(modelName);
}
