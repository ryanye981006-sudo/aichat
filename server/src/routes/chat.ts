// SSE 流式聊天 —— 核心聊天接口
import { Router, Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { aiSdkService as aiService } from '../services/AiSdkService.js';
import { memoryService } from '../services/MemoryService.js';
import { knowledgeService } from '../services/KnowledgeService.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.post('/completions', async (req: Request, res: Response) => {
  const { assistant_id, conversation_id, message, thinking_mode } = req.body;

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
    'INSERT INTO messages (id, conversation_id, role, content, raw_content) VALUES (?, ?, ?, ?, ?)'
  ).run(userMsgId, activeConvId, 'user', message, message);

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

  // 注入知识库
  let kbIds: string[] = [];
  try {
    kbIds = JSON.parse(assistant.knowledge_base_ids || '[]');
  } catch { kbIds = []; }

  if (kbIds.length > 0) {
    const kbResults = await knowledgeService.search(kbIds, message);
    if (kbResults.length > 0) {
      const kbContext = kbResults.map((r, i) => `${i + 1}. [来源: ${r.documentName}] ${r.content}`).join('\n\n');
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

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendSSE = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 客户端断开连接时中止 LLM 调用
  const abortController = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  // 发送对话 ID
  sendSSE({ type: 'meta', conversation_id: activeConvId });

  const chatMessages = [
    { role: 'system' as const, content: systemContent },
    ...historySlice
      .filter((m: any) => m.role !== 'system')
      .map((m: any) => ({
        role: m.role === 'model' ? 'assistant' as const : 'user' as const,
        content: m.raw_content || m.content,
      })),
  ];

  let fullRawContent = '';

  // 调用 LLM 流式（传入 abortSignal 以支持中止）
  await aiService.chatStream(
    chatMessages,
    assistant.model_id,
    assistant.provider_id,
    assistant.temperature_enabled ? assistant.temperature : 0.7,
    {
      onToken(token: string) {
        fullRawContent += token;
        sendSSE({ type: 'token', content: token });

        // 解析思考过程
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
      onComplete(fullText: string, metrics) {
        // 解析最终内容
        const thinkMatch = fullText.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
        let parsedContent = fullText;
        let thoughtProcess: string | null = null;

        if (thinkMatch) {
          thoughtProcess = thinkMatch[1].trim();
          parsedContent = fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
        }

        // 保存助手消息到 DB（含性能指标）
        const aiMsgId = uuidv4();
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, prompt_tokens, completion_tokens, ttft_ms, tokens_per_second) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          aiMsgId, activeConvId, 'assistant', parsedContent, fullText, thoughtProcess,
          metrics?.promptTokens ?? null,
          metrics?.completionTokens ?? null,
          metrics?.ttftMs ?? null,
          metrics?.tokensPerSecond ?? null,
        );

        // 更新对话时间
        db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(activeConvId);

        // 发送完成事件
        sendSSE({
          type: 'done',
          message_id: aiMsgId,
          content: parsedContent,
          thoughtProcess,
          metrics: metrics || null,
        });

        res.end();

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
        res.end();
      },
    },
    abortController.signal,
  );

  // 如果被中止，保存已有内容并通知前端
  if (abortController.signal.aborted && fullRawContent) {
    const thinkMatch = fullRawContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    let parsedContent = fullRawContent;
    let thoughtProcess: string | null = null;
    if (thinkMatch) {
      thoughtProcess = thinkMatch[1].trim();
      parsedContent = fullRawContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    }
    const aiMsgId = uuidv4();
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, activeConvId, 'assistant', parsedContent, fullRawContent, thoughtProcess);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(activeConvId);
    sendSSE({ type: 'done', message_id: aiMsgId, content: parsedContent, thoughtProcess, aborted: true });
  }
  res.end();
});

// 重新生成 —— 删除指定助手消息后重新调用 LLM
router.post('/regenerate', async (req: Request, res: Response) => {
  const { assistant_id, conversation_id, message_id, thinking_mode } = req.body;

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
  try {
    kbIds = JSON.parse(assistant.knowledge_base_ids || '[]');
  } catch { kbIds = []; }
  if (kbIds.length > 0) {
    const kbResults = await knowledgeService.search(kbIds, lastUserMsg.content);
    if (kbResults.length > 0) {
      const kbContext = kbResults.map((r, i) => `${i + 1}. [来源: ${r.documentName}] ${r.content}`).join('\n\n');
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendSSE = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 客户端断开连接时中止 LLM 调用
  const abortController = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  const chatMessages = [
    { role: 'system' as const, content: systemContent },
    ...historySlice
      .filter((m: any) => m.role !== 'system')
      .map((m: any) => ({
        role: m.role === 'model' ? 'assistant' as const : 'user' as const,
        content: m.raw_content || m.content,
      })),
  ];

  let fullRawContent = '';

  await aiService.chatStream(
    chatMessages,
    assistant.model_id,
    assistant.provider_id,
    assistant.temperature_enabled ? assistant.temperature : 0.7,
    {
      onToken(token: string) {
        fullRawContent += token;
        sendSSE({ type: 'token', content: token });
        const thinkMatch = fullRawContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
        if (thinkMatch) {
          const thoughtProcess = thinkMatch[1].trim();
          const displayContent = fullRawContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
          sendSSE({ type: 'parsed', thoughtProcess, displayContent });
        }
      },
      onComplete(fullText: string, metrics) {
        const thinkMatch = fullText.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
        let parsedContent = fullText;
        let thoughtProcess: string | null = null;
        if (thinkMatch) {
          thoughtProcess = thinkMatch[1].trim();
          parsedContent = fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
        }

        const aiMsgId = uuidv4();
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process, prompt_tokens, completion_tokens, ttft_ms, tokens_per_second) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          aiMsgId, conversation_id, 'assistant', parsedContent, fullText, thoughtProcess,
          metrics?.promptTokens ?? null,
          metrics?.completionTokens ?? null,
          metrics?.ttftMs ?? null,
          metrics?.tokensPerSecond ?? null,
        );

        db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation_id);

        sendSSE({
          type: 'done',
          message_id: aiMsgId,
          content: parsedContent,
          thoughtProcess,
          metrics: metrics || null,
        });

        res.end();

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
        sendSSE({ type: 'error', message: error.message });
        res.end();
      },
    },
    abortController.signal,
  );

  // 如果被中止，保存已有内容并通知前端
  if (abortController.signal.aborted && fullRawContent) {
    const thinkMatch = fullRawContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    let parsedContent = fullRawContent;
    let thoughtProcess: string | null = null;
    if (thinkMatch) {
      thoughtProcess = thinkMatch[1].trim();
      parsedContent = fullRawContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    }
    const aiMsgId = uuidv4();
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, raw_content, thought_process) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, conversation_id, 'assistant', parsedContent, fullRawContent, thoughtProcess);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation_id);
    sendSSE({ type: 'done', message_id: aiMsgId, content: parsedContent, thoughtProcess, aborted: true });
  }
  res.end();
});

export default router;
