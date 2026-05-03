// 多提供商 LLM 抽象：使用 Vercel AI SDK (OpenAI 兼容协议) 调用各厂商 API
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText as _streamText, generateText as _generateText } from 'ai'
import { getDb } from '../db/connection.js'

// 缓存 provider SDK 实例，避免每次请求重新创建连接
const modelCache = new Map<string, any>()

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onReasoning: (token: string) => void
  onComplete: (fullText: string, metrics?: StreamMetrics, reasoningText?: string) => void
  onError: (error: Error) => void
}

export interface StreamMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  ttftMs: number        // 首字时延 (Time To First Token)
  tokensPerSecond: number
}

// 规范化 base_url：
// - 移除多余的 /chat/completions、/embeddings、/models 后缀
// - 如果路径中没有 /v1、/v4 等版本段，自动补充 /v1
// - 去掉尾部斜杠
export function normalizeBaseUrl(url: string): string {
  let cleaned = url
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/embeddings\/?$/, '')
    .replace(/\/models\/?$/, '')
    .replace(/\/+$/, '')

  // 检查路径中是否已有版本段（/v1, /v4 等），没有则补充 /v1
  try {
    const pathname = new URL(cleaned).pathname
    if (!/\/v\d+(\/|$)/.test(pathname)) {
      cleaned = cleaned + '/v1'
    }
  } catch {
    // URL 无效时不做处理
  }

  return cleaned.replace(/\/+$/, '')
}

/**
 * 根据 provider 记录创建 AI SDK 模型实例
 * 使用缓存避免每次请求重新创建 HTTP 连接
 */
function createModel(provider: any, model: any) {
  const cacheKey = `${provider.id}:${model.id}`
  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey)
  }

  const baseURL = normalizeBaseUrl(provider.base_url)

  const openaiCompatible = createOpenAICompatible({
    name: provider.name,
    baseURL,
    apiKey: provider.api_key,
    includeUsage: true,
  })
  const modelInstance = openaiCompatible.languageModel(model.name)
  modelCache.set(cacheKey, modelInstance)
  return modelInstance
}

export class AiSdkService {
  // 流式聊天
  async chatStream(
    messages: ChatMessage[],
    modelId: string,
    providerId: string,
    temperature: number,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal,
    thinkingMode?: string,
  ): Promise<void> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider?.enabled) {
      callbacks.onError(new Error('模型提供商未启用'))
      return
    }

    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId) as any
    if (!model) {
      callbacks.onError(new Error('模型不存在'))
      return
    }

    // 检查是否已被取消
    if (abortSignal?.aborted) {
      callbacks.onError(new Error('请求被中止'))
      return
    }

    let streamResult: any = null

    try {
      const startTime = Date.now()
      let firstTokenTime = 0
      let fullText = ''

      const sdkModel = createModel(provider, model)

      // 构建 providerOptions：传递思考控制参数
      const providerOptions: Record<string, any> = {}
      if (thinkingMode === 'disabled' || thinkingMode === 'enabled') {
        providerOptions.openaiCompatible = {
          enable_thinking: thinkingMode === 'enabled',
        }
      }

      streamResult = await _streamText({
        model: sdkModel,
        messages,
        temperature,
        abortSignal,
        ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
      })
      // 使用 fullStream 消费 —— 既可获取文本也能从 finish 事件获取 usage
      let reasoningText = ''
      for await (const part of streamResult.fullStream) {
        if (abortSignal?.aborted) break

        switch (part.type) {
          case 'text-delta': {
            if (firstTokenTime === 0) {
              firstTokenTime = Date.now()
            }
            const text = part.text
            fullText += text
            callbacks.onToken(text)
            break
          }
          case 'reasoning-delta': {
            if (firstTokenTime === 0) {
              firstTokenTime = Date.now()
            }
            reasoningText += part.text
            callbacks.onReasoning(part.text)
            break
          }
          case 'error': {
            callbacks.onError(new Error(String(part.error)))
            return
          }
        }
      }

      // 如果被中止，不触发 onComplete
      if (abortSignal?.aborted) {
        return
      }

      // 收集用量和性能指标
      let metrics: StreamMetrics | undefined
      try {
        // 尝试从 streamResult.usage 获取（camelCase）
        const usage = await streamResult.usage
        const endTime = Date.now()

        // 兼容 snake_case 回退（部分 API 如 DashScope 使用 prompt_tokens 等）
        const rawUsage = usage as any
        const inputTokens = usage.inputTokens || rawUsage?.prompt_tokens || rawUsage?.promptTokens || 0
        const outputTokens = usage.outputTokens || rawUsage?.completion_tokens || rawUsage?.completionTokens || 0
        const ttftMs = firstTokenTime > 0 ? firstTokenTime - startTime : 0
        const generationTime = firstTokenTime > 0 ? endTime - firstTokenTime : 1
        const tokensPerSecond = generationTime > 0 ? Math.round(outputTokens / (generationTime / 1000)) : 0

        metrics = {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
          ttftMs,
          tokensPerSecond,
        }
      } catch {
        console.warn('[AiSdkService] 无法获取 token 用量信息')
      }

      callbacks.onComplete(fullText, metrics, reasoningText || undefined)
    } catch (err: any) {
      if (err?.name === 'AbortError' || abortSignal?.aborted) {
        return // 用户主动取消，不报错
      }
      console.error('[AiSdkService] streamText 异常:', err)
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // 非流式调用（用于记忆提取等后台任务）
  async chat(
    messages: ChatMessage[],
    modelId: string,
    providerId: string,
    temperature: number = 0.3
  ): Promise<string> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider?.enabled) {
      throw new Error('模型提供商未启用')
    }

    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId) as any
    if (!model) {
      throw new Error('模型不存在')
    }

    const result = await _generateText({
      model: createModel(provider, model),
      messages,
      temperature,
    })

    return result.text
  }

  // 测试连接
  async testConnection(providerId: string): Promise<void> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider) throw new Error('提供商不存在')

    const baseUrl = normalizeBaseUrl(provider.base_url)
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
      },
    })

    if (!response.ok) {
      throw new Error(`连接失败 (${response.status}): ${response.statusText}`)
    }
  }

  // 测试单个模型连通性（15s 超时）
  async testModel(providerId: string, modelId: string): Promise<{ success: boolean; time: number; error?: string }> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider) throw new Error('提供商不存在')

    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId) as any
    if (!model) throw new Error('模型不存在')

    const baseUrl = normalizeBaseUrl(provider.base_url)
    const startTime = Date.now()

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model: model.name,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)
      const elapsed = Date.now() - startTime

      if (!response.ok) {
        const errData = await response.json().catch(() => ({} as any))
        return { success: false, time: elapsed, error: errData.error?.message || `HTTP ${response.status}` }
      }

      return { success: true, time: elapsed }
    } catch (err: any) {
      const elapsed = Date.now() - startTime
      if (err.name === 'AbortError') {
        return { success: false, time: elapsed, error: '请求超时 (15s)' }
      }
      return { success: false, time: elapsed, error: err.message || '未知错误' }
    }
  }

  // 自动拉取模型列表（SDK 未提供此方法，使用原生 fetch）
  async fetchModels(providerId: string): Promise<any[]> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider) throw new Error('提供商不存在')

    const baseUrl = normalizeBaseUrl(provider.base_url)
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
      },
    })

    if (!response.ok) {
      throw new Error(`拉取模型列表失败 (${response.status})`)
    }

    const data = await response.json() as any
    console.log(`[fetchModels] ${provider.name} 原始响应结构:`, JSON.stringify(data).slice(0, 500))
    // 透传原始模型数据，保留 owned_by 等字段供前端展示
    return (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      ...m,
    }))
  }
}

export const aiSdkService = new AiSdkService()
