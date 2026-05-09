// SSE 流式聊天 —— 核心聊天接口
import { Router, Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { aiSdkService as aiService } from '../services/AiSdkService.js';
import { memoryService } from '../services/MemoryService.js';
import { knowledgeService } from '../services/KnowledgeService.js';
import { loaderService } from '../services/LoaderService.js';
import { upload } from '../services/FileStorage.js';
import { cleanText } from '../utils/cleanText.js';
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
  const { assistant_id, conversation_id, message, thinking_mode, kb_ids } = req.body;

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

  // 确保对话存在
  let activeConvId = conversation_id;
  if (!activeConvId) {
    activeConvId = uuidv4();
    db.prepare(
      'INSERT INTO conversations (id, assistant_id, title) VALUES (?, ?, ?)'
    ).run(activeConvId, assistant_id, message.slice(0, 30));
  }

  // 保存用户消息
  const userMsgId = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, raw_content, model_name, provider_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userMsgId, activeConvId, 'user', message, message, modelName || null, providerName || null);

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
  let systemContent = assistant.system_prompt || '';

  // 注入记忆
  if (assistant.enable_memory) {
    const memories = await memoryService.getMemoriesForChat();
    if (memories) {
      systemContent += `\n\n## 关于用户的长期记忆\n${memories}`;
    }
  }

  // 注入知识库：前端显式传递时以前端为准（含空数组），否则使用助手配置
  let kbIds: string[] = [];
  if (Array.isArray(kb_ids)) {
    kbIds = kb_ids;
  } else {
    try {
      const parsed = JSON.parse(assistant.knowledge_base_ids || '[]');
      // 防御双重 JSON 编码：解析结果仍为字符串则再解析一次
      kbIds = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
      if (!Array.isArray(kbIds)) kbIds = [];
    } catch { kbIds = []; }
  }

  // 知识库检索结果（在注入系统提示词前声明，用于后续引用传递）
  let kbResults: any[] = [];
  const hasKb = kbIds.length > 0;

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

  // 知识库检索
  const tSearchStart = Date.now();
  if (hasKb) {
    sendSSE({ type: 'status', message: '正在检索知识库...' });

    kbResults = await knowledgeService.search(
      kbIds, message, undefined, undefined,
      assistant.provider_id, assistant.model_id, true
    );
    console.log(`[Chat] 知识库检索完成 | 耗时 ${Date.now() - tSearchStart}ms | 结果 ${kbResults.length} 条`);
    if (kbResults.length > 0) {
      const kbContext = kbResults.map((r: any, i: number) => `${i + 1}. [来源: ${r.documentName}] ${r.content}`).join('\n\n');
      systemContent += `\n\n## 相关知识库内容\n${kbContext}`;
    }
  }

  // 深度思考模式控制
  const thinkingMode = thinking_mode || 'default';
  const THINK_ENABLED_INSTRUCTION = '\n\n## 思考要求\n请在回答每个问题时，使用以下格式进行深度思考：\n<think>\n详细的分步推理过程...\n</think>\n\n最终答案。';
  const THINK_DISABLED_INSTRUCTION = '\n\n## 思考要求\n请直接给出答案，不要输出任何思考过程或推理步骤，不要使用 <think> 标签。';
  if (thinkingMode === 'enabled') {
    systemContent += THINK_ENABLED_INSTRUCTION;
  } else if (thinkingMode === 'disabled') {
    systemContent += THINK_DISABLED_INSTRUCTION;
  }

  // 发送对话 ID 和引用信息
  const citations = kbResults.map((r: any) => ({
    documentName: r.documentName,
    score: r.score,
    snippet: r.content.slice(0, 100),
    metadata: r.metadata || null,
  }));

  sendSSE({ type: 'meta', conversation_id: activeConvId, citations });

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
  if (thinkingMode === 'disabled' && isQwenModel(modelName)) {
    const lastUser = [...chatMessages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      lastUser.content = lastUser.content + ' /no_think';
    }
  }

  let fullRawContent = '';
  const tLlmStart = Date.now();
  let firstTokenLogged = false;

  // 调用 LLM 流式（传入 abortSignal 以支持中止）
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

        // 保存助手消息到 DB（含性能指标）
        const aiMsgId = uuidv4();
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, prompt_tokens, completion_tokens, ttft_ms, tokens_per_second, citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          aiMsgId, activeConvId, 'assistant', parsedContent, fullText, thoughtProcess,
          modelName, providerName || null,
          metrics?.promptTokens ?? null,
          metrics?.completionTokens ?? null,
          metrics?.ttftMs ?? null,
          metrics?.tokensPerSecond ?? null,
          citations.length > 0 ? JSON.stringify(citations) : null,
        );

        // 更新对话时间
        db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(activeConvId);

        // 发送完成事件（含计时明细用于调试）
        const totalMs = Date.now() - requestStartTime;
        const kbSearchMs = tLlmStart - tSearchStart;
        sendSSE({
          type: 'done',
          message_id: aiMsgId,
          content: parsedContent,
          thoughtProcess,
          metrics: metrics || null,
          timing: { totalMs, kbSearchMs, llmTtftMs: metrics?.ttftMs ?? null },
        });

        endResponse();

        // 异步处理记忆提取
        if (assistant.enable_memory) {
          const recentMessages = db.prepare(
            'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
          ).all(activeConvId, 20) as any[];

          memoryService.extractFacts(recentMessages.reverse())
            .then(facts => memoryService.processFacts(facts))
            .catch(err => console.error('[Chat] 异步记忆处理失败:', err));
        }
      },
      onError(error: Error) {
        sendSSE({ type: 'error', message: error.message });
        endResponse();
      },
    },
    abortController.signal,
    thinkingMode,
    requestStartTime,
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
      'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, activeConvId, 'assistant', parsedContent, content, thoughtProcess, modelName, providerName || null, citations.length > 0 ? JSON.stringify(citations) : null);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(activeConvId);
    sendSSE({ type: 'done', message_id: aiMsgId, content: parsedContent, thoughtProcess, aborted: true });
  }
  endResponse();
});

// 重新生成 —— 删除指定助手消息后重新调用 LLM
router.post('/regenerate', async (req: Request, res: Response) => {
  const { assistant_id, conversation_id, message_id, thinking_mode, kb_ids } = req.body;

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

  // 构建系统提示词
  let systemContent = assistant.system_prompt || '';
  if (assistant.enable_memory) {
    const memories = await memoryService.getMemoriesForChat();
    if (memories) {
      systemContent += `\n\n## 关于用户的长期记忆\n${memories}`;
    }
  }
  let kbIds: string[] = [];
  if (Array.isArray(kb_ids)) {
    kbIds = kb_ids;
  } else {
    try {
      const parsed = JSON.parse(assistant.knowledge_base_ids || '[]');
      kbIds = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
      if (!Array.isArray(kbIds)) kbIds = [];
    } catch { kbIds = []; }
  }
  let kbResults: any[] = [];
  const hasKb = kbIds.length > 0;

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

  // 知识库检索
  const tSearchStart = Date.now();
  if (hasKb) {
    sendSSE({ type: 'status', message: '正在检索知识库...' });
    kbResults = await knowledgeService.search(
      kbIds, lastUserMsg.content, undefined, undefined,
      assistant.provider_id, assistant.model_id
    );
    console.log(`[Chat/Regen] 知识库检索完成 | 耗时 ${Date.now() - tSearchStart}ms | 结果 ${kbResults.length} 条`);
    if (kbResults.length > 0) {
      const kbContext = kbResults.map((r: any, i: number) => `${i + 1}. [来源: ${r.documentName}] ${r.content}`).join('\n\n');
      systemContent += `\n\n## 相关知识库内容\n${kbContext}`;
    }
  }

  // 深度思考模式控制
  const regenThinkingMode = thinking_mode || 'default';
  if (regenThinkingMode === 'enabled') {
    systemContent += '\n\n## 思考要求\n请在回答每个问题时，使用以下格式进行深度思考：\n<think>\n详细的分步推理过程...\n</think>\n\n最终答案。';
  } else if (regenThinkingMode === 'disabled') {
    systemContent += '\n\n## 思考要求\n请直接给出答案，不要输出任何思考过程或推理步骤，不要使用 <think> 标签。';
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

  // 构建引用信息
  const citations = kbResults.map((r: any) => ({
    documentName: r.documentName,
    score: r.score,
    snippet: r.content.slice(0, 100),
    metadata: r.metadata || null,
  }));
  sendSSE({ type: 'meta', conversation_id, citations });

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
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, prompt_tokens, completion_tokens, ttft_ms, tokens_per_second, citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          aiMsgId, conversation_id, 'assistant', parsedContent, fullText, thoughtProcess,
          modelName, providerName || null,
          metrics?.promptTokens ?? null,
          metrics?.completionTokens ?? null,
          metrics?.ttftMs ?? null,
          metrics?.tokensPerSecond ?? null,
          citations.length > 0 ? JSON.stringify(citations) : null,
        );

        db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation_id);

        const totalMs = Date.now() - requestStartTime;
        const kbSearchMs = tLlmStart - tSearchStart;
        sendSSE({
          type: 'done',
          message_id: aiMsgId,
          content: parsedContent,
          thoughtProcess,
          metrics: metrics || null,
          timing: { totalMs, kbSearchMs, llmTtftMs: metrics?.ttftMs ?? null },
        });

        endResponse();

        if (assistant.enable_memory) {
          const recentMessages = db.prepare(
            'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
          ).all(conversation_id, 20) as any[];
          memoryService.extractFacts(recentMessages.reverse())
            .then(facts => memoryService.processFacts(facts))
            .catch(err => console.error('[Chat] 异步记忆处理失败:', err));
        }
      },
      onError(error: Error) {
        // 回滚：恢复被删除的消息，避免数据丢失
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(message_id, conversation_id, 'assistant', targetMsg.content, targetMsg.raw_content, targetMsg.thought_process, targetMsg.model_name || modelName, targetMsg.provider_name || providerName || null, targetMsg.citations || null);
        sendSSE({ type: 'error', message: error.message });
        endResponse();
      },
    },
    abortController.signal,
    regenThinkingMode,
    requestStartTime,
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
      'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, model_name, provider_name, citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, conversation_id, 'assistant', parsedContent, content, thoughtProcess, modelName, providerName || null, citations.length > 0 ? JSON.stringify(citations) : null);
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
