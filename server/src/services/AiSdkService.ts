// 多提供商 LLM 抽象：使用 Vercel AI SDK (OpenAI 兼容协议) 调用各厂商 API
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText as _streamText, generateText as _generateText, stepCountIs } from 'ai'
import { getDb } from '../db/connection.js'

// 缓存 provider SDK 实例，避免每次请求重新创建连接
const modelCache = new Map<string, any>()

// 翻译常见 API 错误信息为中文
function translateError(err: any, defaultMsg: string = '未知错误'): string {
  const msg = err?.message || String(err) || defaultMsg
  if (/abort|timeout/i.test(msg)) return '请求超时'
  if (/fetch\s*failed|Failed to fetch/i.test(msg)) return '网络请求失败，请检查 API 地址是否正确'
  if (/401|Unauthorized/i.test(msg)) return 'API 密钥无效或未配置'
  if (/403|Forbidden/i.test(msg)) return 'API 访问被拒绝，请检查密钥权限'
  if (/404|not\s*found|does not exist/i.test(msg)) return '模型不存在，请确认模型名称是否正确'
  if (/function\s*call|tool\s*call|tools|invalid.*tool/i.test(msg)) return '该模型不支持工具调用（记忆搜索/联网搜索），请关闭记忆/联网开关后重发，或切换到 GPT-4o、Claude 等支持 Function Calling 的模型'
  return msg
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onReasoning: (token: string) => void
  onComplete: (fullText: string, metrics?: StreamMetrics, reasoningText?: string) => void
  onError: (error: Error) => void
  onToolCall?: (toolCallId: string, toolName: string, args: any) => void
  onToolResult?: (toolCallId: string, toolName: string, result: any) => void
  onStepStart?: (step: number) => void
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
  const cacheKey = `${provider.id}:${model.id || model.name}`
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
    requestStartTime?: number,  // RAG 场景下从请求入口传入，确保 TTFT 包含检索耗时
    tools?: Record<string, any>,     // AI SDK tools 定义（含 execute）
    maxSteps?: number,               // 工具调用最大轮次
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
      const startTime = requestStartTime ?? Date.now()
      let firstTokenTime = 0
      let fullText = ''

      const sdkModel = createModel(provider, model)

      // 构建 providerOptions：传递思考控制参数
      // 关键：key 必须与 createOpenAICompatible({ name }) 的 name 一致，
      // 因为 AI SDK 用 name 作为 providerOptionsName 来查找 providerOptions。
      // 使用 provider.name 作为 key（与 createModel 中的 name 参数一致）。
      const providerOptions: Record<string, any> = {}
      const optsKey = provider.name
      if (thinkingMode === 'disabled') {
        providerOptions[optsKey] = {
          reasoningEffort: 'none' as const,
          enable_thinking: false,
          thinking: { type: 'disabled' as const },
          chat_template_kwargs: { enable_thinking: false },
        }
      } else if (thinkingMode === 'enabled') {
        providerOptions[optsKey] = {
          enable_thinking: true,
          thinking: { type: 'enabled' as const },
          chat_template_kwargs: { enable_thinking: true },
        }
      }

      streamResult = await _streamText({
        model: sdkModel,
        messages,
        temperature,
        abortSignal,
        ...(tools ? { tools, stopWhen: stepCountIs((maxSteps ?? 3) + 1) } : {}),
        ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
      })
      // 使用 fullStream 消费 —— 既可获取文本也能从 finish 事件获取 usage
      let reasoningText = ''
      let currentStep = 0
      const toolArgsAccumulator = new Map<string, string>()
      for await (const part of streamResult.fullStream) {
        if (abortSignal?.aborted) break

        switch (part.type) {
          case 'start-step': {
            currentStep++
            // 多步执行：工具调用后的新步骤，清空前一步的文本累积，避免内容重复
            if (currentStep > 1) {
              fullText = ''
              callbacks.onStepStart?.(currentStep)
            }
            break
          }
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
          case 'tool-input-start': {
            toolArgsAccumulator.clear()
            break
          }
          case 'tool-input-delta': {
            const current = [...toolArgsAccumulator.values()][0] || ''
            const delta = (part as any).delta || ''
            toolArgsAccumulator.clear()
            toolArgsAccumulator.set('current', current + delta)
            break
          }
          case 'tool-input-end': {
            break
          }
          case 'tool-call': {
            const p = part as any
            const toolCallId = p.toolCallId
            let args: any
            const accumulated = toolArgsAccumulator.get('current')
            if (accumulated) {
              try { args = JSON.parse(accumulated); } catch { args = accumulated; }
            } else if (p.input && typeof p.input === 'object' && Object.keys(p.input).length > 0) {
              args = p.input
            } else if (p.input && typeof p.input === 'string' && p.input !== '{}') {
              try { args = JSON.parse(p.input); } catch { args = {}; }
            } else {
              args = {}
            }
            toolArgsAccumulator.clear()
            callbacks.onToolCall?.(toolCallId, part.toolName, args)
            break
          }
          case 'tool-result': {
            const p = part as any
            callbacks.onToolResult?.(p.toolCallId, p.toolName, p.output)
            break
          }
          case 'error': {
            callbacks.onError(new Error(String(part.error)))
            return
          }
          default: {
            // start, start-step, reasoning-start, reasoning-end, text-start, text-end, finish-step, finish 等事件无需处理
          }
        }
      }

      // 如果被中止，不触发 onComplete
      if (abortSignal?.aborted) {
        if (abortSignal.reason?.name === 'TimeoutError') {
          callbacks.onError(new Error('请求超时，请稍后重试'));
        }
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
        // 超时触发的 abort（与用户主动取消区分）
        if (abortSignal?.reason?.name === 'TimeoutError') {
          callbacks.onError(new Error('请求超时，请稍后重试'));
        }
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
    temperature: number = 0.3,
    abortSignal?: AbortSignal,
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
      abortSignal,
    })

    return result.text
  }

  // 测试单个模型连通性（使用 AI SDK 流式，与真实聊天相同代码路径）
  async testModel(providerId: string, modelId: string): Promise<{ success: boolean; time: number; error?: string }> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider) throw new Error('提供商不存在')

    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId) as any
    if (!model) throw new Error('模型不存在')

    const startTime = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let receivedFirstToken = false

    try {
      const streamResult = await _streamText({
        model: createModel(provider, model),
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 10,
        abortSignal: controller.signal,
      })

      for await (const part of streamResult.fullStream) {
        if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
          receivedFirstToken = true
          controller.abort()
          break
        }
        if (part.type === 'error') {
          clearTimeout(timeout)
          return { success: false, time: Date.now() - startTime, error: translateError(part.error, '未知错误') }
        }
      }

      clearTimeout(timeout)
      return { success: true, time: Date.now() - startTime }
    } catch (err: any) {
      clearTimeout(timeout)
      const elapsed = Date.now() - startTime
      if (err.name === 'AbortError') {
        if (receivedFirstToken) {
          return { success: true, time: elapsed }
        }
        return { success: false, time: elapsed, error: '请求超时 (15s)' }
      }
      return { success: false, time: elapsed, error: translateError(err, '未知错误') }
    }
  }

  // 验证模型名称是否在 API 上可用（流式测试，收到首个 token 即返回）
  async validateModel(providerId: string, modelName: string): Promise<{ valid: boolean; time: number; error?: string }> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider) throw new Error('提供商不存在')

    // 检查是否已存在同名模型
    const existing = db.prepare('SELECT id FROM models WHERE provider_id = ? AND name = ?')
      .get(providerId, modelName) as any
    if (existing) {
      return { valid: false, time: 0, error: '该模型已存在于此供应商下' }
    }

    const startTime = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let receivedFirstToken = false

    try {
      const sdkModel = createModel(provider, { name: modelName })
      const streamResult = await _streamText({
        model: sdkModel,
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 10,
        abortSignal: controller.signal,
      })

      for await (const part of streamResult.fullStream) {
        if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
          receivedFirstToken = true
          controller.abort()
          break
        }
        if (part.type === 'error') {
          clearTimeout(timeout)
          return { valid: false, time: Date.now() - startTime, error: translateError(part.error, '验证失败') }
        }
      }

      clearTimeout(timeout)
      return { valid: true, time: Date.now() - startTime }
    } catch (err: any) {
      clearTimeout(timeout)
      if (err.name === 'AbortError' && receivedFirstToken) {
        return { valid: true, time: Date.now() - startTime }
      }
      if (err.name === 'AbortError') {
        return { valid: false, time: Date.now() - startTime, error: '请求超时，模型未在 15 秒内响应' }
      }
      return { valid: false, time: Date.now() - startTime, error: translateError(err, '验证失败') }
    }
  }

  // 自动拉取模型列表（SDK 未提供此方法，使用原生 fetch）
  async fetchModels(providerId: string): Promise<any[]> {
    const db = getDb()
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any
    if (!provider) throw new Error('提供商不存在')

    const baseUrl = normalizeBaseUrl(provider.base_url)
    const url = `${baseUrl}/models`
    console.log(`[fetchModels] 请求: GET ${url}`)

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${provider.api_key}`,
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error(`[fetchModels] 失败: ${response.status} — ${body.slice(0, 300)}`)
      throw new Error(`获取模型列表失败 (${response.status}): ${body.slice(0, 100)}`)
    }

    const data = await response.json() as any
    console.log(`[fetchModels] 成功: ${provider.name} 获取到 ${(data.data || []).length} 个模型`)
    // 透传原始模型数据，保留 owned_by 等字段供前端展示
    return (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      ...m,
    }))
  }
}

export const aiSdkService = new AiSdkService()
