// 多提供商 LLM 抽象：使用 Vercel AI SDK (OpenAI 兼容协议) 调用各厂商 API
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText as _streamText, generateText as _generateText } from 'ai'
import { getDb } from '../db/connection.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
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
 * AI SDK 会在 baseURL 后自动拼接 /chat/completions
 */
function createModel(provider: any, model: any) {
  const baseURL = normalizeBaseUrl(provider.base_url)

  const openaiCompatible = createOpenAICompatible({
    name: provider.name,
    baseURL,
    apiKey: provider.api_key,
  })
  return openaiCompatible.languageModel(model.name)
}

export class AiSdkService {
  // 流式聊天
  async chatStream(
    messages: ChatMessage[],
    modelId: string,
    providerId: string,
    temperature: number,
    callbacks: StreamCallbacks
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

    try {
      const result = await _streamText({
        model: createModel(provider, model),
        messages,
        temperature,
      })

      let fullText = ''
      for await (const chunk of result.textStream) {
        fullText += chunk
        callbacks.onToken(chunk)
      }

      callbacks.onComplete(fullText)
    } catch (err) {
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
