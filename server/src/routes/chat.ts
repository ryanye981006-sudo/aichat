// SSE 流式聊天 —— 核心聊天接口
import { Router, Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { aiSdkService as aiService } from '../services/AiSdkService.js';
import type { MessageContentPart } from '../services/AiSdkService.js';
import { memoryService } from '../services/MemoryService.js';
import { loaderService } from '../services/LoaderService.js';
import { userProfileService } from '../services/UserProfileService.js';
import { conversationChunkService } from '../services/ConversationChunkService.js';
import { toolDefinitionBuilder } from '../services/ToolDefinitionBuilder.js';
import { toolExecutor } from '../services/ToolExecutor.js';
import { webSearchService } from '../services/WebSearchService.js';
import { upload } from '../services/FileStorage.js';
import { cleanText } from '../utils/cleanText.js';
import { config } from '../config.js';
import { emitUserInputStart, emitAiThinkingStart, emitResponseStart, emitResponseComplete, emitError } from '../services/PetEventBus.js';

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

const router = Router();

// Qwen 模型检测：用于 /no_think 后缀控制
function isQwenModel(modelName: string): boolean {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  return name.includes('qwen') || name.includes('qwq') || name.includes('qvq');
}

router.post('/completions', async (req: Request, res: Response) => {
  const { assistant_id, conversation_id, message, thinking_mode, web_search_enabled, memory_enabled, files } = req.body;

  if (!assistant_id || !message) {
    res.status(400).json({ error: 'assistant_id 和 message 不能为空' });
    return;
  }

  const db = getDb();

  // 加载助手配置
  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(assistant_id) as any;
  if (!assistant) {
    res.status(404).json({ error: '助手不存在' });
    return;
  }

  if (!assistant.model_id || !assistant.provider_id) {
    res.status(400).json({ error: '助手未配置模型，请先在设置中为助手选择模型' });
    return;
  }

  // 加载模型名称和供应商名称（用于 Qwen /no_think 后缀检测、消息记录等）
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(assistant.model_id) as any;
  const modelName = model?.name || '';
  const providerName = model
    ? (db.prepare('SELECT name FROM providers WHERE id = ?').get(model.provider_id) as any)?.name || ''
    : '';

  // 全局记忆开关（memory_settings 表）
  const memorySettings = db.prepare('SELECT enabled FROM memory_settings WHERE id = 1').get() as any;
  const globalMemoryEnabled = memorySettings?.enabled === 1;

  // 确保对话存在
  let activeConvId = conversation_id;
  if (!activeConvId) {
    activeConvId = uuidv4();
    db.prepare(
      'INSERT INTO conversations (id, assistant_id, title) VALUES (?, ?, ?)'
    ).run(activeConvId, assistant_id, message.slice(0, 30));
  }

  // 获取对话隐私模式快照
  const conv = db.prepare('SELECT privacy_mode FROM conversations WHERE id = ?').get(activeConvId) as any;
  const convPrivacyMode = conv?.privacy_mode || 0;

  // 分配 turn_index
  const turnIndex = conversationChunkService.assignTurnIndex(activeConvId);

  // 保存用户消息（含消息快照字段）
  const userMsgId = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, raw_content, model_name, provider_name, turn_index, memory_enabled, privacy_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userMsgId, activeConvId, 'user', message, message, modelName || null, providerName || null, turnIndex, globalMemoryEnabled ? 1 : 0, convPrivacyMode);

  // 更新对话时间
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(activeConvId);

  // 加载对话历史（按上下文轮数截断）
  const historyMessages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(activeConvId) as any[];

  const rounds = assistant.context_rounds ?? 10;
  let historySlice = historyMessages;
  if (rounds > 0 && rounds < 1000) {
    const countToKeep = rounds * 2;
    if (historyMessages.length > countToKeep) {
      historySlice = historyMessages.slice(historyMessages.length - countToKeep);
    }
  }

  // 构建系统提示词（整合记忆 + 知识库）
  const today = new Date().toISOString().slice(0, 10);
  let systemContent = assistant.system_prompt || '';
  systemContent += `\n\n今天的日期是 ${today}。当用户要求搜索"最新"、"最近"、"今天"等内容时，请使用此日期作为参考。`;

  // 注入用户个人信息（固定拼接，不走检索）
  systemContent += userProfileService.buildProfileSection();

  // 记录请求入口时间，用于 TTFT 计算（含知识库检索耗时）
  const requestStartTime = Date.now();

  // SSE 提前建立，让用户立刻看到状态反馈
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 防止重复调用 res.end() 导致进程崩溃
  let responseEnded = false;
  const endResponse = () => {
    if (!responseEnded) {
      responseEnded = true;
      res.end();
    }
  };

  const sendSSE = (data: Record<string, unknown>) => {
    if (!responseEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  // 客户端断开连接时中止 LLM 调用
  const abortController = new AbortController();
  let clientDisconnected = false;
  const handleDisconnect = () => {
    if (!clientDisconnected) {
      clientDisconnected = true;
      abortController.abort();
    }
  };
  res.on('close', handleDisconnect);
  req.on('aborted', handleDisconnect);

  // 深度思考模式控制
  const thinkingMode = thinking_mode || 'default';
  const THINK_ENABLED_INSTRUCTION = '\n\n## 思考要求\n请在回答每个问题时，使用以下格式进行深度思考：\n<think>\n详细的分步推理过程...\n</think>\n\n最终答案。';
  const THINK_DISABLED_INSTRUCTION = '\n\n## 思考要求\n请直接给出答案，不要输出任何思考过程或推理步骤，不要使用 <think> 标签。\n\n## 工具使用规则（必须遵守）\n你拥有 search_memory（检索长期记忆）和 web_search（联网搜索）两个工具。以下情况必须先调用工具，不得跳过：\n- 用户提到"之前""上次""还记得""讨论过""聊过"等词 → 必须先 search_memory\n- 用户询问实时信息（天气、价格、新闻、活动、优惠等） → 必须先 web_search\n- 用户要求"搜索""查一下""搜一下" → 必须先执行对应搜索\n- 不确定某个事实或数据时 → 先搜索，不要猜测';
  if (thinkingMode === 'enabled') {
    systemContent += THINK_ENABLED_INSTRUCTION;
  } else if (thinkingMode === 'disabled') {
    systemContent += THINK_DISABLED_INSTRUCTION;
  }

  sendSSE({ type: 'meta', conversation_id: activeConvId, citations: [] });

  // 桌宠事件：用户输入已处理
  emitUserInputStart(activeConvId, assistant.name, message.length);

  const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }> = [
    { role: 'system' as const, content: systemContent },
    ...historySlice
      .filter((m: any) => m.role !== 'system')
      .map((m: any) => ({
        role: m.role === 'model' ? 'assistant' as const : 'user' as const,
        content: m.raw_content || m.content,
      })),
  ];

  // 注入文件内容到最后一条用户消息（多模态）
  const requestFiles: any[] = files || [];
  if (requestFiles.length > 0) {
    const lastUserIdx = chatMessages.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      const parts: MessageContentPart[] = [
        { type: 'text', text: message || '请分析下列文件' },
      ];
      for (const file of requestFiles) {
        if (file.category === 'image' && file.dataUrl) {
          parts.push({ type: 'image', image: file.dataUrl });
        } else if (file.uploadResult) {
          if (file.uploadResult.extractedText) {
            parts.push({ type: 'text', text: `\n\n--- 文件: ${file.name} ---\n${file.uploadResult.extractedText}\n--- 文件结束 ---` });
          }
          if (file.uploadResult.images?.length) {
            for (const img of file.uploadResult.images) {
              parts.push({ type: 'image', image: img.dataUrl });
            }
          }
        }
      }
      chatMessages[lastUserIdx].content = parts;
    }
  }

  // Qwen 模型关闭思考时，在最后一条用户消息末尾追加 /no_think（兜底控制）
  if (thinkingMode === 'disabled' && isQwenModel(modelName)) {
    const lastUser = [...chatMessages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      if (typeof lastUser.content === 'string') {
        lastUser.content = lastUser.content + ' /no_think';
      } else if (Array.isArray(lastUser.content)) {
        const textPart = lastUser.content.find((p: any) => p.type === 'text');
        if (textPart) textPart.text += ' /no_think';
        else lastUser.content.push({ type: 'text', text: '/no_think' });
      }
    }
  }

  // 确定联网搜索开关：前端请求参数优先，否则看搜索引擎是否可用
  const webSearchEnabled = web_search_enabled !== undefined ? !!web_search_enabled : webSearchService.isAvailable();
  // 记忆开关：前端请求参数优先，否则看全局设置
  const effectiveMemoryEnabled = memory_enabled !== undefined ? !!memory_enabled : globalMemoryEnabled;
  // 知识库开关：服务端自动检测（有默认 KB 且有已完成文档）
  const knowledgeEnabled = (() => {
    const kb = db.prepare('SELECT id FROM knowledge_bases LIMIT 1').get() as any;
    if (!kb) return false;
    const doc = db.prepare(
      "SELECT COUNT(*) as c FROM knowledge_documents WHERE knowledge_base_id = ? AND processing_status = 'completed'"
    ).get(kb.id) as any;
    return doc?.c > 0;
  })();

  // 构建工具（含 execute 包装 + per-tool 调用上限）
  const toolSchemas = toolDefinitionBuilder.buildTools({
    memoryEnabled: effectiveMemoryEnabled,
    webSearchEnabled,
    knowledgeEnabled,
  });
  let tools: Record<string, any> | undefined;
  const toolCallCounts = new Map<string, number>();
  const toolCallEntries: any[] = [];

  function wrapWithLimit(toolName: string, execute: (args: any) => Promise<any>) {
    return async (args: any) => {
      const count = toolCallCounts.get(toolName) || 0;
      if (count >= config.maxToolCallPerTool) {
        return { error: `${toolName} 调用次数已达上限（${config.maxToolCallPerTool}次），请基于现有结果回答` };
      }
      toolCallCounts.set(toolName, count + 1);
      return execute(args);
    };
  }

  if (toolSchemas) {
    tools = {};
    for (const [name, def] of Object.entries(toolSchemas)) {
      tools[name] = {
        ...def,
        execute: wrapWithLimit(name, async (args: any) => toolExecutor.execute(name, args, message)),
      };
    }
    // 注入工具使用规范：最终回复中不泄露内部标识
    const toolInstruction = '\n\n## 回复规范\n在给用户的最终回复中，不要出现任何记忆 ID（如 UUID 格式的字符串）或内部工具名称（如 search_memory、recall_context）。用自然语言直接回答即可。';
    systemContent += toolInstruction;
    chatMessages[0].content += toolInstruction;
  }

  let fullRawContent = '';
  const tLlmStart = Date.now();
  let firstTokenLogged = false;

  // 桌宠事件：AI 开始推理
  emitAiThinkingStart(activeConvId);

  // 调用 LLM 流式（传入 abortSignal 以支持中止，传入 tools 支持记忆检索）
  await aiService.chatStream(
    chatMessages,
    assistant.model_id,
    assistant.provider_id,
    assistant.temperature_enabled ? assistant.temperature : 0.7,
    {
      onToken(token: string) {
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          console.log(`[Chat] 首字到达 | 总TTFT ${Date.now() - requestStartTime}ms | LLM首字 ${Date.now() - tLlmStart}ms`);
          // 桌宠事件：流式输出开始
          emitResponseStart(activeConvId);
        }
        fullRawContent += token;
        sendSSE({ type: 'token', content: token });

        // 解析思考过程（兼容 <think> 标签格式）
        const thinkMatch = fullRawContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
        if (thinkMatch) {
          const thoughtProcess = thinkMatch[1].trim();
          const displayContent = fullRawContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
          sendSSE({
            type: 'parsed',
            thoughtProcess,
            displayContent,
          });
        }
      },
      onReasoning(token: string) {
        sendSSE({ type: 'reasoning', content: token });
      },
      onComplete(fullText: string, metrics, reasoningText?: string) {
        // 解析最终内容
        // 优先使用 AI SDK 分离的推理内容，其次从 <think> 标签中解析
        let parsedContent = fullText;
        let thoughtProcess: string | null = null;

        if (reasoningText) {
          thoughtProcess = reasoningText.trim();
        } else {
          const thinkMatch = fullText.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
          if (thinkMatch) {
            thoughtProcess = thinkMatch[1].trim();
            parsedContent = fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
          }
        }

        // 保存助手消息到 DB（含性能指标 + 快照字段 + 工具调用）
        const aiMsgId = uuidv4();
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, prompt_tokens, completion_tokens, ttft_ms, tokens_per_second, citations, tool_calls, turn_index, memory_enabled, privacy_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          aiMsgId, activeConvId, 'assistant', parsedContent, fullText, thoughtProcess,
          modelName, providerName || null,
          metrics?.promptTokens ?? null,
          metrics?.completionTokens ?? null,
          metrics?.ttftMs ?? null,
          metrics?.tokensPerSecond ?? null,
          null,
          (() => {
            // 过滤掉未完成的幽灵工具调用（status 仍为 running 且无实质参数/结果）
            const cleaned = toolCallEntries.filter(e => !(e.status === 'running' && !e.result))
            return cleaned.length > 0 ? JSON.stringify(cleaned) : null
          })(),
          turnIndex, effectiveMemoryEnabled ? 1 : 0, convPrivacyMode,
        );

        // 更新对话时间
        db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(activeConvId);

        // 桌宠事件：回复完成
        const totalMs = Date.now() - requestStartTime;
        const totalTokens = (metrics?.promptTokens || 0) + (metrics?.completionTokens || 0);
        emitResponseComplete(activeConvId, totalTokens, totalMs);

        // 发送完成事件（含计时明细用于调试）
        sendSSE({
          type: 'done',
          message_id: aiMsgId,
          content: parsedContent,
          thoughtProcess,
          metrics: metrics || null,
          timing: { totalMs },
        });

        endResponse();

        // 超出 L0 后进入 L1 chunk 归档 + 边界检测
        if (turnIndex > rounds) {
          // 同步确保 open chunk 存在，防止首次进入 L1 时竞态导致消息丢失
          const chunkId = conversationChunkService.ensureOpenChunk(activeConvId, turnIndex);
          // 批量归档所有尚未关联的消息（幂等：首次回填历史，后续仅补增量）
          conversationChunkService.addAllMessagesToChunk(chunkId, activeConvId);
          // 异步检查边界（语义相似度 + 轮数上限强制闭合）
          conversationChunkService.checkChunkBoundaryAsync(activeConvId)
            .then(result => {
              if (result.closed) {
                console.log(`[Chat] Chunk 闭合触发 | conv=${activeConvId} | chunkId=${result.chunkId}`);
              }
            })
            .catch(err => console.error('[Chat] Chunk 边界检测失败:', err));
        }
      },
      onError(error: Error) {
        emitError(activeConvId, error.message);
        sendSSE({ type: 'error', message: error.message });
        endResponse();
      },
      onToolCall(toolCallId: string, toolName: string, args: any) {
        toolCallEntries.push({
          toolCallId,
          toolName,
          args,
          status: 'running',
          started_at: new Date().toISOString(),
        });
        sendSSE({ type: 'tool_call', toolCallId, toolName, args });
      },
      onToolResult(toolCallId: string, toolName: string, result: any) {
        const entry = toolCallEntries.find(e => e.toolCallId === toolCallId);
        if (entry) {
          entry.result = result;
          entry.status = 'done';
          entry.completed_at = new Date().toISOString();
        }
        sendSSE({ type: 'tool_result', toolCallId, toolName, result });
      },
    },
    AbortSignal.any([abortController.signal, AbortSignal.timeout(config.llmTimeoutMs)]),
    thinkingMode,
    requestStartTime,
    tools,
    Object.keys(tools || {}).length * config.maxToolCallPerTool, // maxSteps：工具数 × 单工具上限，不设全局轮次限制
  );

  // 如果被中止，保存已有内容（即使为空也保存，确保消息持久化）
  if (abortController.signal.aborted) {
    const content = fullRawContent || '';
    const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    let parsedContent = content;
    let thoughtProcess: string | null = null;
    if (thinkMatch) {
      thoughtProcess = thinkMatch[1].trim();
      parsedContent = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    }
    const aiMsgId = uuidv4();
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, citations, tool_calls, turn_index, memory_enabled, privacy_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, activeConvId, 'assistant', parsedContent, content, thoughtProcess, modelName, providerName || null, null, toolCallEntries.length > 0 ? JSON.stringify(toolCallEntries) : null, turnIndex, effectiveMemoryEnabled ? 1 : 0, convPrivacyMode);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(activeConvId);
    sendSSE({ type: 'done', message_id: aiMsgId, content: parsedContent, thoughtProcess, aborted: true });
  }
  endResponse();
});

// 重新生成 —— 删除指定助手消息后重新调用 LLM
router.post('/regenerate', async (req: Request, res: Response) => {
  const { assistant_id, conversation_id, message_id, thinking_mode, web_search_enabled, memory_enabled } = req.body;

  if (!assistant_id || !conversation_id || !message_id) {
    res.status(400).json({ error: 'assistant_id、conversation_id 和 message_id 不能为空' });
    return;
  }

  const db = getDb();

  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(assistant_id) as any;
  if (!assistant) {
    res.status(404).json({ error: '助手不存在' });
    return;
  }

  if (!assistant.model_id || !assistant.provider_id) {
    res.status(400).json({ error: '助手未配置模型，请先在设置中为助手选择模型' });
    return;
  }

  // 加载模型名称和供应商名称（用于 Qwen /no_think 后缀检测、消息记录等）
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(assistant.model_id) as any;
  const modelName = model?.name || '';
  const providerName = model
    ? (db.prepare('SELECT name FROM providers WHERE id = ?').get(model.provider_id) as any)?.name || ''
    : '';

  // 全局记忆开关（memory_settings 表）
  const memorySettings = db.prepare('SELECT enabled FROM memory_settings WHERE id = 1').get() as any;
  const globalMemoryEnabled = memorySettings?.enabled === 1;

  // 验证消息存在且为助手消息
  const targetMsg = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND role = ?').get(message_id, conversation_id, 'assistant') as any;
  if (!targetMsg) {
    res.status(404).json({ error: '目标消息不存在或不是助手消息' });
    return;
  }

  // 删除该助手消息
  db.prepare('DELETE FROM messages WHERE id = ?').run(message_id);

  // 获取该消息之前的所有历史（含用户消息和更早的助手消息）
  const historyMessages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND id != ? ORDER BY created_at ASC'
  ).all(conversation_id, message_id) as any[];

  // 找到最后一条用户消息作为"当前提问"
  const lastUserMsg = [...historyMessages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) {
    res.status(400).json({ error: '找不到对应的用户消息' });
    return;
  }

  // 构建系统提示词（注入用户个人信息，记忆改为工具检索）
  const today2 = new Date().toISOString().slice(0, 10);
  let systemContent = assistant.system_prompt || '';
  systemContent += `\n\n今天的日期是 ${today2}。当用户要求搜索"最新"、"最近"、"今天"等内容时，请使用此日期作为参考。`;
  systemContent += userProfileService.buildProfileSection();

  // 记录请求入口时间，用于 TTFT 计算（含知识库检索耗时）
  const requestStartTime = Date.now();

  // SSE 提前建立，让用户立刻看到状态反馈
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 防止重复调用 res.end() 导致进程崩溃
  let responseEnded = false;
  const endResponse = () => {
    if (!responseEnded) {
      responseEnded = true;
      res.end();
    }
  };

  const sendSSE = (data: Record<string, unknown>) => {
    if (!responseEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  // 客户端断开连接时中止 LLM 调用
  const abortController = new AbortController();
  let clientDisconnected = false;
  const handleDisconnect = () => {
    if (!clientDisconnected) {
      clientDisconnected = true;
      abortController.abort();
    }
  };
  res.on('close', handleDisconnect);
  req.on('aborted', handleDisconnect);

  // 深度思考模式控制
  const regenThinkingMode = thinking_mode || 'default';
  if (regenThinkingMode === 'enabled') {
    systemContent += '\n\n## 思考要求\n请在回答每个问题时，使用以下格式进行深度思考：\n<think>\n详细的分步推理过程...\n</think>\n\n最终答案。';
  } else if (regenThinkingMode === 'disabled') {
    systemContent += '\n\n## 思考要求\n请直接给出答案，不要输出任何思考过程或推理步骤，不要使用 <think> 标签。\n\n## 工具使用规则（必须遵守）\n你拥有 search_memory（检索长期记忆）和 web_search（联网搜索）两个工具。以下情况必须先调用工具，不得跳过：\n- 用户提到"之前""上次""还记得""讨论过""聊过"等词 → 必须先 search_memory\n- 用户询问实时信息（天气、价格、新闻、活动、优惠等） → 必须先 web_search\n- 用户要求"搜索""查一下""搜一下" → 必须先执行对应搜索\n- 不确定某个事实或数据时 → 先搜索，不要猜测';
  }

  // 上下文轮数截断
  const rounds = assistant.context_rounds ?? 10;
  let historySlice = historyMessages;
  if (rounds > 0 && rounds < 1000) {
    const countToKeep = rounds * 2;
    if (historyMessages.length > countToKeep) {
      historySlice = historyMessages.slice(historyMessages.length - countToKeep);
    }
  }

  sendSSE({ type: 'meta', conversation_id, citations: [] });

  const chatMessages = [
    { role: 'system' as const, content: systemContent },
    ...historySlice
      .filter((m: any) => m.role !== 'system')
      .map((m: any) => ({
        role: m.role === 'model' ? 'assistant' as const : 'user' as const,
        content: m.raw_content || m.content,
      })),
  ];

  // Qwen 模型关闭思考时，在最后一条用户消息末尾追加 /no_think（兜底控制）
  if (regenThinkingMode === 'disabled' && isQwenModel(modelName)) {
    const lastUser = [...chatMessages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      lastUser.content = lastUser.content + ' /no_think';
    }
  }

  // 获取原始消息的 turn_index 和快照（重新生成时复用）
  const regenTurnIndex = targetMsg.turn_index || lastUserMsg.turn_index || 0;
  const regenPrivacyMode = lastUserMsg.privacy_mode ?? 0;

  // 联网搜索：前端请求参数优先，否则看搜索引擎是否可用
  const regenWebSearchEnabled = web_search_enabled !== undefined ? !!web_search_enabled : webSearchService.isAvailable();
  const regenMemoryBool = memory_enabled !== undefined ? !!memory_enabled : globalMemoryEnabled;
  const regenMemoryEnabled = regenMemoryBool ? 1 : 0;

  // 知识库开关：服务端自动检测（同 /completions）
  const regenKnowledgeEnabled = (() => {
    const kb = db.prepare('SELECT id FROM knowledge_bases LIMIT 1').get() as any;
    if (!kb) return false;
    const doc = db.prepare(
      "SELECT COUNT(*) as c FROM knowledge_documents WHERE knowledge_base_id = ? AND processing_status = 'completed'"
    ).get(kb.id) as any;
    return doc?.c > 0;
  })();

  // 构建工具（含 per-tool 调用上限）
  const regenToolSchemas = toolDefinitionBuilder.buildTools({
    memoryEnabled: regenMemoryBool,
    webSearchEnabled: regenWebSearchEnabled,
    knowledgeEnabled: regenKnowledgeEnabled,
  });
  let regenTools: Record<string, any> | undefined;
  const regenToolCallCounts = new Map<string, number>();
  const regenToolCallEntries: any[] = [];

  function regenWrapWithLimit(toolName: string, execute: (args: any) => Promise<any>) {
    return async (args: any) => {
      const count = regenToolCallCounts.get(toolName) || 0;
      if (count >= config.maxToolCallPerTool) {
        return { error: `${toolName} 调用次数已达上限（${config.maxToolCallPerTool}次），请基于现有结果回答` };
      }
      regenToolCallCounts.set(toolName, count + 1);
      return execute(args);
    };
  }

  if (regenToolSchemas) {
    regenTools = {};
    for (const [name, def] of Object.entries(regenToolSchemas)) {
      regenTools[name] = {
        ...def,
        execute: regenWrapWithLimit(name, async (args: any) => toolExecutor.execute(name, args, lastUserMsg.content)),
      };
    }
    const toolInstruction = '\n\n## 回复规范\n在给用户的最终回复中，不要出现任何记忆 ID（如 UUID 格式的字符串）或内部工具名称（如 search_memory、recall_context）。用自然语言直接回答即可。';
    chatMessages[0].content += toolInstruction;
  }

  let fullRawContent = '';
  const tLlmStart = Date.now();
  let firstTokenLogged = false;

  await aiService.chatStream(
    chatMessages,
    assistant.model_id,
    assistant.provider_id,
    assistant.temperature_enabled ? assistant.temperature : 0.7,
    {
      onToken(token: string) {
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          console.log(`[Chat/Regen] 首字到达 | 总TTFT ${Date.now() - requestStartTime}ms | LLM首字 ${Date.now() - tLlmStart}ms`);
        }
        fullRawContent += token;
        sendSSE({ type: 'token', content: token });
        const thinkMatch = fullRawContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
        if (thinkMatch) {
          const thoughtProcess = thinkMatch[1].trim();
          const displayContent = fullRawContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
          sendSSE({ type: 'parsed', thoughtProcess, displayContent });
        }
      },
      onReasoning(token: string) {
        sendSSE({ type: 'reasoning', content: token });
      },
      onComplete(fullText: string, metrics, reasoningText?: string) {
        let parsedContent = fullText;
        let thoughtProcess: string | null = null;
        if (reasoningText) {
          thoughtProcess = reasoningText.trim();
        } else {
          const thinkMatch = fullText.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
          if (thinkMatch) {
            thoughtProcess = thinkMatch[1].trim();
            parsedContent = fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
          }
        }

        const aiMsgId = uuidv4();
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, prompt_tokens, completion_tokens, ttft_ms, tokens_per_second, citations, tool_calls, turn_index, memory_enabled, privacy_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          aiMsgId, conversation_id, 'assistant', parsedContent, fullText, thoughtProcess,
          modelName, providerName || null,
          metrics?.promptTokens ?? null,
          metrics?.completionTokens ?? null,
          metrics?.ttftMs ?? null,
          metrics?.tokensPerSecond ?? null,
          null,
          (() => {
            const cleaned = regenToolCallEntries.filter(e => !(e.status === 'running' && !e.result))
            return cleaned.length > 0 ? JSON.stringify(cleaned) : null
          })(),
          regenTurnIndex, regenMemoryEnabled, regenPrivacyMode,
        );

        db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation_id);

        const totalMs = Date.now() - requestStartTime;
        sendSSE({
          type: 'done',
          message_id: aiMsgId,
          content: parsedContent,
          thoughtProcess,
          metrics: metrics || null,
          timing: { totalMs },
        });

        endResponse();
      },
      onError(error: Error) {
        // 回滚：恢复被删除的消息，避免数据丢失（保留原始快照字段）
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, citations, turn_index, memory_enabled, privacy_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(message_id, conversation_id, 'assistant', targetMsg.content, targetMsg.raw_content, targetMsg.thought_process, targetMsg.model_name || modelName, targetMsg.provider_name || providerName || null, targetMsg.citations || null, targetMsg.turn_index || 0, targetMsg.memory_enabled || 0, targetMsg.privacy_mode || 0);
        sendSSE({ type: 'error', message: error.message });
        endResponse();
      },
      onToolCall(toolCallId: string, toolName: string, args: any) {
        regenToolCallEntries.push({
          toolCallId,
          toolName,
          args,
          status: 'running',
          started_at: new Date().toISOString(),
        });
        sendSSE({ type: 'tool_call', toolCallId, toolName, args });
      },
      onToolResult(toolCallId: string, toolName: string, result: any) {
        const entry = regenToolCallEntries.find(e => e.toolCallId === toolCallId);
        if (entry) {
          entry.result = result;
          entry.status = 'done';
          entry.completed_at = new Date().toISOString();
        }
        sendSSE({ type: 'tool_result', toolCallId, toolName, result });
      },
    },
    AbortSignal.any([abortController.signal, AbortSignal.timeout(config.llmTimeoutMs)]),
    regenThinkingMode,
    requestStartTime,
    regenTools,
    Object.keys(regenTools || {}).length * config.maxToolCallPerTool,
  );

  // 如果被中止，保存已有内容（即使为空也保存，确保消息持久化）
  if (abortController.signal.aborted) {
    const content = fullRawContent || '';
    const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    let parsedContent = content;
    let thoughtProcess: string | null = null;
    if (thinkMatch) {
      thoughtProcess = thinkMatch[1].trim();
      parsedContent = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    }
    const aiMsgId = uuidv4();
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, citations, tool_calls, turn_index, memory_enabled, privacy_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, conversation_id, 'assistant', parsedContent, content, thoughtProcess, modelName, providerName || null, null, (() => { const c = regenToolCallEntries.filter(e => !(e.status === 'running' && !e.result)); return c.length > 0 ? JSON.stringify(c) : null; })(), regenTurnIndex, regenMemoryEnabled, regenPrivacyMode);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation_id);
    sendSSE({ type: 'done', message_id: aiMsgId, content: parsedContent, thoughtProcess, aborted: true });
  }
  endResponse();
});

// ===== 聊天文件上传（文档解析 + 扫描件 OCR 决策）=====
router.post('/upload-file', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '未选择文件' });
      return;
    }

    const isVisionModel = req.body.isVisionModel === 'true';
    const filePath = req.file.path;
    const mimeType = req.file.mimetype;

    // 调用 LoaderService 解析文件
    const loadResult = await loaderService.loadFile(filePath, mimeType);

    // 文本清洗
    const cleanedText = cleanText(loadResult.text);

    // 扫描件检测（仅 PDF 文件）
    const isPdf = mimeType === 'application/pdf';
    let isScanned = false;
    if (isPdf) {
      const pageCount = loadResult.images.length > 0 ? Math.max(...loadResult.images.map(i => i.page), 1) : undefined;
      isScanned = loaderService.isScannedPdf(loadResult, pageCount);
    }

    let images: { mimeType: string; dataUrl: string }[] | undefined;

    if (isPdf && isScanned && loadResult.text.trim().length < 100) {
      if (isVisionModel) {
        // Vision 模型：渲染 PDF 页面为 PNG，模型直接阅读
        try {
          const pages = await loaderService.renderPagesAsImages(filePath);
          images = pages.map(p => ({
            mimeType: p.mimeType,
            dataUrl: `data:${p.mimeType};base64,${p.data.toString('base64')}`,
          }));
          console.log(`[Chat] 扫描件 PDF，vision 模型，渲染 ${pages.length} 页 PNG`);
        } catch (err) {
          console.warn('[Chat] PDF 页面渲染失败，回退到文本:', (err as Error).message);
        }
      } else {
        // 非 Vision 模型：DeepSeek-OCR（PDF 直接输入，不渲染）
        try {
          const { deepSeekOcrService } = await import('../services/DeepSeekOcrService.js');
          const ocrResult = await deepSeekOcrService.extractPdf(fs.readFileSync(filePath));
          if (ocrResult?.text) {
            res.json({
              filePath: req.file.filename,
              fileName: req.file.originalname,
              mimeType,
              extractedText: cleanText(ocrResult.text),
              isScannedPdf: true,
            });
            return;
          }
        } catch (err) {
          console.warn('[Chat] DeepSeek-OCR 失败:', (err as Error).message);
        }
        // OCR 失败 → 返回错误提示
        res.status(422).json({
          error: '此 PDF 为扫描件且当前模型不支持视觉能力。请切换到视觉模型（如 GPT-4o / Claude）或手动提取文字后发送。',
          isScannedPdf: true,
        });
        return;
      }
    }

    res.json({
      filePath: req.file.filename,
      fileName: req.file.originalname,
      mimeType,
      extractedText: cleanedText,
      isScannedPdf: isScanned,
      images,
    });
  } catch (err) {
    console.error('[Chat] 文件上传处理失败:', err);
    res.status(500).json({ error: `文件处理失败: ${(err as Error).message}` });
  }
});

export default router;
