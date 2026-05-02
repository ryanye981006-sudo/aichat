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

/**
 * 根据 provider 记录创建 AI SDK 模型实例
 */
function createModel(provider: any, model: any) {
  // 清理 base_url，移除 /chat/completions、/embeddings 等路径后缀
  // AI SDK 会自己拼接 /chat/completions
  let baseURL = provider.base_url
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/embeddings\/?$/, '')
    .replace(/\/v1\/?$/, '/v1')
  // 确保不以 / 结尾
  baseURL = baseURL.replace(/\/+$/, '')

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

    const response = await fetch(`${provider.base_url}/models`, {
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
      },
    })

    if (!response.ok) {
      throw new Error(`连接失败 (${response.status}): ${response.statusText}`)
    }
  }

  // 自动拉取模型列表（SDK 未提供此方法，使用原生 fetch）
  async fetchModels(providerId: string): Promise<{ id: string; name: string }[]> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider) throw new Error('提供商不存在')

    const response = await fetch(`${provider.base_url}/models`, {
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
      },
    })

    if (!response.ok) {
      throw new Error(`拉取模型列表失败 (${response.status})`)
    }

    const data = await response.json() as any
    return (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
    }))
  }
}

export const aiSdkService = new AiSdkService()
