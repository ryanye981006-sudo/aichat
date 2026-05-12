import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import AssistantModal from './components/AssistantModal';
import SettingsArea from './components/SettingsArea';
import type { Assistant, Provider, Model, Conversation, Message, ConversationUIState } from './types';
import { assistantsApi, conversationsApi, messagesApi, providersApi, modelsApi, chatSSE, regenerateSSE } from './services/api';
import { generateId } from './lib/utils';

export default function App() {
  // ===== 核心状态 =====
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentAssistantId, setCurrentAssistantId] = useState<string | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [isSettingsMode, setIsSettingsMode] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'model' | 'rag' | 'memory' | 'profile'>('model');
  const [sidebarTab, setSidebarTab] = useState<'assistants' | 'topics'>('assistants');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [citationsByConv, setCitationsByConv] = useState<Record<string, any[]>>({});
  const [kbSearchStatus, setKbSearchStatus] = useState<string | null>(null);

  // 会话级 UI 状态：深度思考 + 联网搜索（按会话缓存，切换重置）
  const [conversationUIState, setConversationUIState] = useState<Record<string, ConversationUIState>>({});

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);

  // 知识库选择按助手维度缓存：切换会话时保持选中
  const assistantKbCacheRef = useRef<Record<string, string[]>>({});
  // 消息按会话维度缓存：流式生成中切出再切回时保留流式状态
  const messagesCacheRef = useRef<Record<string, Message[]>>({});
  // 当前会话 ID 的同步 ref：供 SSE 异步回调判断用户是否已切走
  const currentConversationIdRef = useRef(currentConversationId);
  currentConversationIdRef.current = currentConversationId;
  // 按会话维度保存 AbortController：切回后仍能停止后台 SSE
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  // 当前会话的 citations，从 citationsByConv 按 conversationId 派生
  const citations = currentConversationId ? (citationsByConv[currentConversationId] || []) : [];

  // 当前助手
  const currentAssistant = assistants.find(a => a.id === currentAssistantId) || null;

  // 当前会话 UI 状态（深度思考模式 + 联网搜索开关）
  const currentUIState: ConversationUIState = currentConversationId
    ? conversationUIState[currentConversationId] || {
        deepThinkingMode: true,
        webSearchEnabled: true,
      }
    : { deepThinkingMode: true, webSearchEnabled: true };

  const setCurrentUIState = (updates: Partial<ConversationUIState>) => {
    if (!currentConversationId) return;
    setConversationUIState(prev => ({
      ...prev,
      [currentConversationId]: { ...currentUIState, ...updates },
    }));
  };

  // ===== 初始化加载 =====
  useEffect(() => {
    loadInitialData();
  }, []);

  // 监听记忆来源跳转事件（从 SettingsArea 记忆详情弹窗触发）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.conversationId) {
        setCurrentConversationId(detail.conversationId);
      }
    };
    window.addEventListener('navigate-conversation', handler);
    return () => window.removeEventListener('navigate-conversation', handler);
  }, []);

  const loadInitialData = async () => {
    try {
      const [as, ps, ms] = await Promise.all([
        assistantsApi.list(),
        providersApi.list(),
        modelsApi.list(),
      ]);
      setAssistants(as);
      setProviders(ps);
      setModels(ms);
      if (as.length > 0 && !currentAssistantId) {
        setCurrentAssistantId(as[0].id);
        loadConversations(as[0].id);
      }
    } catch (e) {
      console.error('初始化加载失败:', e);
    }
  };

  const loadConversations = async (assistantId: string) => {
    try {
      const convs = await conversationsApi.list(assistantId);
      setConversations(convs);
    } catch (e) { console.error(e); }
  };

  // 将服务端扁平列转换为前端对象（metrics + citations JSON 解析）
  const normalizeMessage = (msg: any): Message => {
    let normalized = { ...msg };

    // 解析 citations JSON 字符串
    if (typeof normalized.citations === 'string' && normalized.citations) {
      try {
        normalized.citations = JSON.parse(normalized.citations);
      } catch {
        normalized.citations = null;
      }
    }

    // 解析 tool_calls JSON 字符串
    if (typeof normalized.tool_calls === 'string' && normalized.tool_calls) {
      try {
        normalized.toolCalls = JSON.parse(normalized.tool_calls).map((tc: any) => ({
          ...tc,
          startedAt: tc.started_at,
          completedAt: tc.completed_at,
        }));
      } catch {
        normalized.toolCalls = undefined;
      }
    }

    if (normalized.metrics) return normalized;

    const promptTokens = normalized.prompt_tokens ?? 0;
    const completionTokens = normalized.completion_tokens ?? 0;
    if (promptTokens > 0 || completionTokens > 0) {
      return {
        ...normalized,
        metrics: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          ttftMs: normalized.ttft_ms ?? 0,
          tokensPerSecond: normalized.tokens_per_second ?? 0,
        },
      };
    }
    return normalized;
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const msgs = await messagesApi.list(conversationId);
      const normalized = msgs.map(normalizeMessage);
      setMessages(normalized);
      // 从历史消息中恢复 citations（取最后一条助手消息的）
      const lastAssistant = [...normalized].reverse().find((m: any) => m.role === 'assistant' && m.citations);
      if (lastAssistant) {
        setCitationsByConv(prev => ({ ...prev, [conversationId]: lastAssistant.citations }));
      }
    } catch (e) { console.error(e); }
  };

  // ===== 助手操作 =====
  const handleSelectAssistant = useCallback(async (id: string) => {
    // 不中止 SSE，让其继续在后台运行并更新缓存
    // 只清理当前会话的全局流式标记
    setIsStreaming(false);
    setStreamingConversationId(null);

    // 缓存当前会话消息（含流式中的临时消息），切回时恢复
    if (currentConversationId) {
      messagesCacheRef.current[currentConversationId] = messages;
    }

    setCurrentAssistantId(id);
    setSidebarTab('topics');
    setIsSettingsMode(false);
    try {
      const convs = await conversationsApi.list(id);
      setConversations(convs);
      if (convs.length > 0) {
        const latest = convs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
        // 手动同步 ref，消除切换时 ref 与 state 的时序差
        currentConversationIdRef.current = latest.id;
        setCurrentConversationId(latest.id);
        // 若目标会话仍有活跃 SSE，恢复流式状态（停止按钮可用）
        if (abortControllersRef.current[latest.id]) {
          setIsStreaming(true);
          setStreamingConversationId(latest.id);
          setAbortController(abortControllersRef.current[latest.id]);
        }
        // 优先从缓存恢复
        const cached = messagesCacheRef.current[latest.id];
        if (cached && cached.length > 0) {
          setMessages(cached);
        } else {
          loadMessages(latest.id);
        }
      } else {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error(e);
      setCurrentConversationId(null);
      setMessages([]);
    }
  }, [currentConversationId, messages]);

  const handleCreateAssistant = () => {
    setEditingAssistant(null);
    setIsModalOpen(true);
  };

  const handleEditAssistant = async (assistant: Assistant) => {
    try {
      const [ps, ms] = await Promise.all([providersApi.list(), modelsApi.list()]);
      setProviders(ps);
      setModels(ms);
    } catch (e) { console.error(e); }
    setEditingAssistant(assistant);
    setIsModalOpen(true);
  };

  const handleSaveAssistant = async (data: Partial<Assistant>) => {
    try {
      if (editingAssistant) {
        const updated = await assistantsApi.update(editingAssistant.id, data);
        setAssistants(prev => prev.map(a => a.id === updated.id ? updated : a));
      } else {
        const created = await assistantsApi.create(data);
        setAssistants(prev => [created, ...prev]);
        setCurrentAssistantId(created.id);
        setSidebarTab('topics');
        const conv = await conversationsApi.create(created.id, '新话题');
        setConversations([conv]);
        setCurrentConversationId(conv.id);
        setMessages([]);
      }
    } catch (e) { console.error(e); }
  };

  const handleRemoveAssistant = async (id: string) => {
    try {
      await assistantsApi.remove(id);
      setAssistants(prev => prev.filter(a => a.id !== id));
      if (currentAssistantId === id) {
        setCurrentAssistantId(null);
        setCurrentConversationId(null);
        setMessages([]);
        setConversations([]);
      }
    } catch (e) { console.error(e); }
  };

  const handleRemoveConversation = async (id: string) => {
    try {
      await conversationsApi.remove(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (e) { console.error(e); }
  };

  // ===== 对话操作 =====
  const handleSelectConversation = useCallback((id: string) => {
    if (id === currentConversationId) return;

    // 不中止 SSE，让其继续在后台运行并更新缓存
    // 只清理当前会话的全局流式标记
    setIsStreaming(false);
    setStreamingConversationId(null);

    // 缓存当前会话消息（保留流式中的临时消息）
    if (currentConversationId) {
      messagesCacheRef.current[currentConversationId] = messages;
    }

    // 手动同步 ref，消除切换时 ref 与 state 的时序差，防止 SSE 回调被误拦
    currentConversationIdRef.current = id;
    setCurrentConversationId(id);
    setIsSettingsMode(false);

    // 若目标会话仍有活跃 SSE，恢复流式状态（停止按钮可用）
    if (abortControllersRef.current[id]) {
      setIsStreaming(true);
      setStreamingConversationId(id);
      setAbortController(abortControllersRef.current[id]);
    }

    // 优先从缓存恢复，缓存未命中才从服务端加载
    const cached = messagesCacheRef.current[id];
    if (cached && cached.length > 0) {
      setMessages(cached);
    } else {
      loadMessages(id);
    }
    const conv = conversations.find(c => c.id === id);
    if (conv) {
      setCurrentAssistantId(conv.assistant_id);
    }
  }, [conversations, messages, currentConversationId]);

  const handleCreateConversation = async () => {
    if (!currentAssistantId) return;

    // 不中止 SSE，让其继续在后台运行并更新缓存
    // 只清理当前会话的全局流式标记
    setIsStreaming(false);
    setStreamingConversationId(null);
    if (currentConversationId) {
      messagesCacheRef.current[currentConversationId] = messages;
    }

    try {
      const conv = await conversationsApi.create(currentAssistantId, '新话题');
      setConversations(prev => [conv, ...prev]);
      // 手动同步 ref
      currentConversationIdRef.current = conv.id;
      setCurrentConversationId(conv.id);
      setMessages([]);
      setIsSettingsMode(false);
    } catch (e) { console.error(e); }
  };

  // ===== 发送消息 =====
  const handleSendMessage = useCallback(async (content: string, thinkingMode: string = 'default', kbIds: string[] = [], files?: import('./types').FileAttachment[]) => {
    if (!currentAssistantId) return;

    // 只阻止当前活跃会话在流式时发送消息
    if (isStreaming && streamingConversationId === currentConversationId) return;

    let activeConvId = currentConversationId;

    if (!activeConvId) {
      try {
        const conv = await conversationsApi.create(currentAssistantId, content.slice(0, 30));
        setConversations(prev => [conv, ...prev]);
        activeConvId = conv.id;
        setCurrentConversationId(conv.id);
        // 同步更新 ref，确保 SSE 回调中的 currentConversationIdRef 守卫不被误拦
        currentConversationIdRef.current = conv.id;
      } catch (e) {
        console.error('创建对话失败:', e);
        return;
      }
    }

    const userMsg: Message = {
      id: `temp-${generateId()}`,
      conversation_id: activeConvId,
      role: 'user',
      content,
      raw_content: content,
      thought_process: null,
      turn_index: 0,
      memory_enabled: 0,
      privacy_mode: 0,
      created_at: new Date().toISOString(),
    };

    const aiMsg: Message = {
      id: `temp-${generateId()}`,
      conversation_id: activeConvId,
      role: 'assistant',
      content: '',
      raw_content: '',
      thought_process: null,
      turn_index: 0,
      memory_enabled: 0,
      privacy_mode: 0,
      created_at: new Date().toISOString(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setIsStreaming(true);
    setStreamingConversationId(activeConvId);

    const hasMessages = messages.length > 0;
    if (!hasMessages) {
      conversationsApi.update(activeConvId!, { title: content.slice(0, 30) }).then(c => {
        setConversations(prev => prev.map(x => x.id === c.id ? c : x));
      }).catch(() => {});
    }

    let fullRawContent = '';
    let currentReasoning = '';
    let reasoningSegments: any[] = [];

    const controller = chatSSE(currentAssistantId, content, activeConvId, thinkingMode, {
      onMeta(convId, newCitations) {
        // 仅当用户仍在当前会话时才更新会话 ID（避免切走后 meta 事件切换回旧会话）
        if (convId !== activeConvId) {
          if (activeConvId === currentConversationIdRef.current) {
            setCurrentConversationId(convId);
            activeConvId = convId;
            setStreamingConversationId(convId);
            currentConversationIdRef.current = convId;
          }
        }
        // citations 按会话存储到 state，无需守卫：属于其他会话的写入不影响当前 UI
        if (newCitations !== undefined) {
          setCitationsByConv(prev => ({ ...prev, [activeConvId]: newCitations }));
          const cachedMsgs = messagesCacheRef.current[activeConvId];
          if (cachedMsgs) {
            messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
              m.role === 'assistant' ? { ...m, citations: newCitations } : m
            );
          }
        }
      },
      onStatus(message: string) {
        if (activeConvId !== currentConversationIdRef.current) return;
        setKbSearchStatus(message);
      },
      onToken(token) {
        fullRawContent += token;
        // 同步更新缓存（后台 SSE 持续写入，切回时能拿到最新内容）
        const cachedMsgs = messagesCacheRef.current[activeConvId];
        if (cachedMsgs) {
          messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
            m.id === aiMsg.id ? { ...m, raw_content: fullRawContent, content: fullRawContent } : m
          );
        }
        // 仅当用户仍在当前会话时更新 UI
        if (activeConvId !== currentConversationIdRef.current) return;
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, raw_content: fullRawContent, content: fullRawContent } : m
        ));
      },
      onParsed(thoughtProcess, displayContent) {
        const cachedMsgs = messagesCacheRef.current[activeConvId];
        if (cachedMsgs) {
          messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
            m.id === aiMsg.id ? { ...m, thought_process: thoughtProcess, content: displayContent } : m
          );
        }
        if (activeConvId !== currentConversationIdRef.current) return;
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, thought_process: thoughtProcess, content: displayContent } : m
        ));
      },
      onReasoning(token: string) {
        currentReasoning += token;
        // 构建实时 reasoningSegments：当前未闭合的 reasoning 段 + 已完成的 tool_call 段
        const liveSegments = [...reasoningSegments, { type: 'reasoning', text: currentReasoning }];
        const cachedMsgs = messagesCacheRef.current[activeConvId];
        if (cachedMsgs) {
          messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
            m.id === aiMsg.id ? { ...m, thought_process: currentReasoning, reasoningSegments: liveSegments } : m
          );
        }
        if (activeConvId !== currentConversationIdRef.current) return;
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, thought_process: currentReasoning, reasoningSegments: liveSegments } : m
        ));
      },
      onDone(messageId, content, thoughtProcess, metrics, aborted) {
        setKbSearchStatus(null);

        // 刷新剩余推理缓冲为最后一个 reasoning 段
        if (currentReasoning) {
          reasoningSegments.push({ type: 'reasoning', text: currentReasoning });
        }
        const finalSegments = [...reasoningSegments];

        const finalizeMessage = (prev: Message[]) => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, id: messageId, content, thought_process: thoughtProcess, metrics: metrics || null, aborted: aborted || false, isStreaming: false, reasoningSegments: finalSegments }
            : m
        );

        const isCurrentConv = activeConvId === currentConversationIdRef.current;
        if (isCurrentConv) {
          setMessages(finalizeMessage);
          setIsStreaming(false);
          setStreamingConversationId(null);
          setAbortController(null);
          delete abortControllersRef.current[activeConvId];
          delete messagesCacheRef.current[activeConvId];
          // 不再调用 loadMessages：finalizeMessage 已包含正确的 reasoningSegments 交错顺序，
          // loadMessages 会从 DB 加载扁平数据，丢失工具调用的位置信息。
          // 用户切换会话时 loadMessages 仍会触发，保证数据一致性。
          if (currentAssistantId) loadConversations(currentAssistantId);
        } else {
          // 用户已切走：更新缓存为完成态，不污染当前会话的全局状态
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) {
            messagesCacheRef.current[activeConvId] = finalizeMessage(cached);
          }
        }
      },
      onToolCall(toolCallId, toolName, args) {
        // 刷新当前推理缓冲为 reasoning 段，然后插入 tool_call 段
        if (currentReasoning) {
          reasoningSegments.push({ type: 'reasoning', text: currentReasoning });
          currentReasoning = '';
        }
        const tcEntry = { toolCallId, toolName, args, status: 'running' as const };
        reasoningSegments.push({ type: 'tool_call', toolCall: tcEntry });
        // 同时维护旧 toolCalls 字段（向后兼容）
        const updateTc = (prev: Message[]) => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, toolCalls: [...(m.toolCalls || []), tcEntry], reasoningSegments: [...reasoningSegments] }
            : m
        );
        if (activeConvId === currentConversationIdRef.current) {
          setMessages(updateTc);
        } else {
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) messagesCacheRef.current[activeConvId] = updateTc(cached);
        }
      },
      onToolResult(toolCallId, toolName, result) {
        // 更新 reasoningSegments 中对应 tool_call 的状态
        reasoningSegments = reasoningSegments.map(seg =>
          seg.type === 'tool_call' && seg.toolCall.toolCallId === toolCallId
            ? { ...seg, toolCall: { ...seg.toolCall, result, status: 'done' as const } }
            : seg
        );
        // 清除同工具名下无结果的幽灵 running 条目（模型有时会发空参数的预调用）
        reasoningSegments = reasoningSegments.filter(seg =>
          !(seg.type === 'tool_call' && seg.toolCall.toolName === toolName && seg.toolCall.status === 'running' && !seg.toolCall.result)
        );
        const updateTr = (prev: Message[]) => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, toolCalls: (m.toolCalls || []).filter(tc =>
                !(tc.toolName === toolName && tc.status === 'running' && !tc.result)
              ).map(tc =>
                tc.toolCallId === toolCallId ? { ...tc, result, status: 'done' as const } : tc
              ), reasoningSegments: [...reasoningSegments] }
            : m
        );
        if (activeConvId === currentConversationIdRef.current) {
          setMessages(updateTr);
        } else {
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) messagesCacheRef.current[activeConvId] = updateTr(cached);
        }
      },
      onStepStart(step: number) {
        // 多步工具执行：step 2+ 开始时刷新推理缓冲并清空前一步的草稿文本
        if (currentReasoning) {
          reasoningSegments.push({ type: 'reasoning', text: currentReasoning });
          currentReasoning = '';
        }
        fullRawContent = '';
        const updateStep = (prev: Message[]) => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, raw_content: '', content: '', thought_process: null }
            : m
        );
        if (activeConvId === currentConversationIdRef.current) {
          setMessages(updateStep);
        } else {
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) messagesCacheRef.current[activeConvId] = updateStep(cached);
        }
      },
      onError(error) {
        setKbSearchStatus(null);

        const finalizeError = (prev: Message[]) => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, content: `错误: ${error}`, isStreaming: false }
            : m
        );

        const isCurrentConv = activeConvId === currentConversationIdRef.current;
        if (isCurrentConv) {
          setMessages(finalizeError);
          setIsStreaming(false);
          setStreamingConversationId(null);
          setAbortController(null);
          delete abortControllersRef.current[activeConvId];
          delete messagesCacheRef.current[activeConvId];
        } else {
          // 用户已切走：更新缓存为错误态，不污染当前会话的全局状态
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) {
            messagesCacheRef.current[activeConvId] = finalizeError(cached);
          }
        }
      },
    }, kbIds, files, { webSearchEnabled: currentUIState.webSearchEnabled });
    abortControllersRef.current[activeConvId] = controller;
    setAbortController(controller);
  }, [currentAssistantId, currentConversationId, isStreaming, streamingConversationId, messages.length]);

  // ===== 重新生成 =====
  const handleRegenerate = useCallback(async (messageId: string, thinkingMode: string = 'default', kbIds: string[] = []) => {
    if (!currentAssistantId || !currentConversationId) return;
    if (isStreaming && streamingConversationId === currentConversationId) return;

    const activeConvId = currentConversationId;

    // 清除旧引用，等待新 meta 事件更新
    setCitationsByConv(prev => ({ ...prev, [activeConvId]: [] }));

    // 立即隐藏旧消息并显示 loading，不等服务端响应
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: '', raw_content: '', thought_process: null, toolCalls: undefined, reasoningSegments: undefined, isStreaming: true, aborted: false, metrics: undefined } : m
    ));
    setIsStreaming(true);
    setStreamingConversationId(activeConvId);

    let effectiveMessageId = messageId;

    // 如果消息 ID 是临时的（被终止的消息），先从服务端加载获取真实 ID
    if (messageId.startsWith('temp-')) {
      try {
        const msgs = await messagesApi.list(activeConvId);
        const normalized = msgs.map(normalizeMessage);

        const lastAi = [...normalized].reverse().find(m => m.role === 'assistant');
        if (!lastAi || lastAi.id.startsWith('temp-')) {
          setIsStreaming(false);
          setStreamingConversationId(null);
          return;
        }
        effectiveMessageId = lastAi.id;
        // 用服务端真实记录替换 temp ID 消息，清空内容并保持 streaming 状态
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...lastAi, content: '', raw_content: '', thought_process: null, toolCalls: undefined, reasoningSegments: undefined, isStreaming: true, aborted: false, metrics: undefined } : m
        ));
      } catch {
        setIsStreaming(false);
        setStreamingConversationId(null);
        return;
      }
    } else {
      // 非 temp-ID：验证消息在服务端是否仍存在（上次 regenerate 被中止后消息 ID 会变化）
      try {
        const msgs = await messagesApi.list(activeConvId);
        const exists = msgs.some((m: any) => m.id === messageId);
        if (!exists) {
          const normalized = msgs.map(normalizeMessage);
          const lastAi = [...normalized].reverse().find((m: any) => m.role === 'assistant');
          if (!lastAi || lastAi.id.startsWith('temp-')) {
            setIsStreaming(false);
            setStreamingConversationId(null);
            return;
          }
          effectiveMessageId = lastAi.id;
          // 同步更新前端消息 ID，保持 streaming 状态
          setMessages(prev => prev.map(m =>
            m.id === messageId ? { ...lastAi, isStreaming: true, aborted: false, content: '', raw_content: '', thought_process: null, metrics: undefined } : m
          ));
        }
      } catch {
        setIsStreaming(false);
        setStreamingConversationId(null);
        return;
      }
    }

    let fullRawContent = '';
    let currentReasoning = '';
    let reasoningSegments: any[] = [];

    const regenController = regenerateSSE(currentAssistantId, activeConvId, effectiveMessageId, thinkingMode, {
      onMeta(_convId, newCitations) {
        // citations 按会话存储，无需守卫：属于其他会话的写入不影响当前 UI
        if (newCitations !== undefined) {
          setCitationsByConv(prev => ({ ...prev, [activeConvId]: newCitations }));
          const cachedMsgs = messagesCacheRef.current[activeConvId];
          if (cachedMsgs) {
            messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
              m.role === 'assistant' ? { ...m, citations: newCitations } : m
            );
          }
        }
      },
      onStatus(message: string) {
        if (activeConvId !== currentConversationIdRef.current) return;
        setKbSearchStatus(message);
      },
      onToken(token) {
        fullRawContent += token;
        const cachedMsgs = messagesCacheRef.current[activeConvId];
        if (cachedMsgs) {
          messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
            m.id === effectiveMessageId ? { ...m, raw_content: fullRawContent, content: fullRawContent, aborted: false } : m
          );
        }
        if (activeConvId !== currentConversationIdRef.current) return;
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId ? { ...m, raw_content: fullRawContent, content: fullRawContent, aborted: false } : m
        ));
      },
      onParsed(thoughtProcess, displayContent) {
        const cachedMsgs = messagesCacheRef.current[activeConvId];
        if (cachedMsgs) {
          messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
            m.id === effectiveMessageId ? { ...m, thought_process: thoughtProcess, content: displayContent, aborted: false } : m
          );
        }
        if (activeConvId !== currentConversationIdRef.current) return;
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId ? { ...m, thought_process: thoughtProcess, content: displayContent, aborted: false } : m
        ));
      },
      onReasoning(token) {
        currentReasoning += token;
        const liveSegments = [...reasoningSegments, { type: 'reasoning', text: currentReasoning }];
        const cachedMsgs = messagesCacheRef.current[activeConvId];
        if (cachedMsgs) {
          messagesCacheRef.current[activeConvId] = cachedMsgs.map(m =>
            m.id === effectiveMessageId ? { ...m, thought_process: currentReasoning, reasoningSegments: liveSegments } : m
          );
        }
        if (activeConvId !== currentConversationIdRef.current) return;
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId ? { ...m, thought_process: currentReasoning, reasoningSegments: liveSegments } : m
        ));
      },
      onDone(newMsgId, content, thoughtProcess, metrics, aborted) {
        setKbSearchStatus(null);

        if (currentReasoning) {
          reasoningSegments.push({ type: 'reasoning', text: currentReasoning });
        }
        const finalSegments = [...reasoningSegments];

        const finalizeMessage = (prev: Message[]) => prev.map(m =>
          m.id === effectiveMessageId
            ? { ...m, id: newMsgId, content, thought_process: thoughtProcess, metrics: metrics || null, aborted: aborted || false, isStreaming: false, reasoningSegments: finalSegments }
            : m
        );

        const isCurrentConv = activeConvId === currentConversationIdRef.current;
        if (isCurrentConv) {
          setMessages(finalizeMessage);
          setIsStreaming(false);
          setStreamingConversationId(null);
          setAbortController(null);
          delete abortControllersRef.current[activeConvId];
          delete messagesCacheRef.current[activeConvId];
          // 不再调用 loadMessages：finalizeMessage 已包含正确的 reasoningSegments 交错顺序，
          // loadMessages 会从 DB 加载扁平数据，丢失工具调用的位置信息。
          if (currentAssistantId) loadConversations(currentAssistantId);
        } else {
          // 用户已切走：更新缓存为完成态，不污染当前会话的全局状态
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) {
            messagesCacheRef.current[activeConvId] = finalizeMessage(cached);
          }
        }
      },
      onToolCall(toolCallId, toolName, args) {
        if (currentReasoning) {
          reasoningSegments.push({ type: 'reasoning', text: currentReasoning });
          currentReasoning = '';
        }
        const tcEntry = { toolCallId, toolName, args, status: 'running' as const };
        reasoningSegments.push({ type: 'tool_call', toolCall: tcEntry });
        const updateTc = (prev: Message[]) => prev.map(m =>
          m.id === effectiveMessageId
            ? { ...m, toolCalls: [...(m.toolCalls || []), tcEntry], reasoningSegments: [...reasoningSegments] }
            : m
        );
        if (activeConvId === currentConversationIdRef.current) {
          setMessages(updateTc);
        } else {
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) messagesCacheRef.current[activeConvId] = updateTc(cached);
        }
      },
      onToolResult(toolCallId, toolName, result) {
        reasoningSegments = reasoningSegments.map(seg =>
          seg.type === 'tool_call' && seg.toolCall.toolCallId === toolCallId
            ? { ...seg, toolCall: { ...seg.toolCall, result, status: 'done' as const } }
            : seg
        );
        const updateTr = (prev: Message[]) => prev.map(m =>
          m.id === effectiveMessageId
            ? { ...m, toolCalls: (m.toolCalls || []).map(tc =>
                tc.toolCallId === toolCallId ? { ...tc, result, status: 'done' as const } : tc
              ), reasoningSegments: [...reasoningSegments] }
            : m
        );
        if (activeConvId === currentConversationIdRef.current) {
          setMessages(updateTr);
        } else {
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) messagesCacheRef.current[activeConvId] = updateTr(cached);
        }
      },
      onStepStart(step: number) {
        if (currentReasoning) {
          reasoningSegments.push({ type: 'reasoning', text: currentReasoning });
          currentReasoning = '';
        }
        fullRawContent = '';
        const updateStep = (prev: Message[]) => prev.map(m =>
          m.id === effectiveMessageId
            ? { ...m, raw_content: '', content: '', thought_process: null }
            : m
        );
        if (activeConvId === currentConversationIdRef.current) {
          setMessages(updateStep);
        } else {
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) messagesCacheRef.current[activeConvId] = updateStep(cached);
        }
      },
      onError(error) {
        setKbSearchStatus(null);

        const finalizeError = (prev: Message[]) => prev.map(m =>
          m.id === effectiveMessageId
            ? { ...m, content: `错误: ${error}`, isStreaming: false }
            : m
        );

        const isCurrentConv = activeConvId === currentConversationIdRef.current;
        if (isCurrentConv) {
          setMessages(finalizeError);
          setIsStreaming(false);
          setStreamingConversationId(null);
          setAbortController(null);
          delete abortControllersRef.current[activeConvId];
          delete messagesCacheRef.current[activeConvId];
        } else {
          // 用户已切走：更新缓存为错误态，不污染当前会话的全局状态
          const cached = messagesCacheRef.current[activeConvId];
          if (cached) {
            messagesCacheRef.current[activeConvId] = finalizeError(cached);
          }
        }
      },
    }, kbIds, { webSearchEnabled: currentUIState.webSearchEnabled });
    abortControllersRef.current[activeConvId] = regenController;
    setAbortController(regenController);
  }, [currentAssistantId, currentConversationId, isStreaming, streamingConversationId, messages]);

  // ===== 停止生成 =====
  const handleStopGeneration = useCallback(() => {
    // 优先从按会话维度的 map 中查找当前会话的 controller
    const convController = currentConversationId ? abortControllersRef.current[currentConversationId] : null;
    if (convController) {
      convController.abort();
      delete abortControllersRef.current[currentConversationId!];
    }
    // 同时清理全局状态中的 controller（兼容性）
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setIsStreaming(false);
    setStreamingConversationId(null);
    setMessages(prev => prev.map(m =>
      m.isStreaming ? { ...m, isStreaming: false, aborted: true } : m
    ));
  }, [abortController, currentConversationId]);

  // ===== 深度思考模式切换 =====
  const handleThinkingModeChange = useCallback(async (mode: string) => {
    if (!currentAssistantId) return;
    try {
      const updated = await assistantsApi.update(currentAssistantId, { thinking_mode: mode });
      setAssistants(prev => prev.map(a => a.id === updated.id ? updated : a));
    } catch (e) { console.error(e); }
  }, [currentAssistantId]);

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          assistants={assistants}
          conversations={conversations}
          currentAssistantId={currentAssistantId}
          currentConversationId={currentConversationId}
          onSelectAssistant={handleSelectAssistant}
          onSelectConversation={handleSelectConversation}
          onCreateAssistant={handleCreateAssistant}
          onCreateConversation={handleCreateConversation}
          onEditAssistant={handleEditAssistant}
          onRemoveAssistant={handleRemoveAssistant}
          onRemoveConversation={handleRemoveConversation}
          isSettingsMode={isSettingsMode}
          onToggleSettings={setIsSettingsMode}
          settingsTab={settingsTab}
          onSettingsTabChange={setSettingsTab}
          sidebarTab={sidebarTab}
          onSidebarTabChange={setSidebarTab}
        />
        {isSettingsMode ? (
          <SettingsArea activeTab={settingsTab} />
        ) : (
          <ChatArea
            assistant={currentAssistant}
            messages={messages}
            onSendMessage={handleSendMessage}
            isStreaming={isStreaming}
            onStopGeneration={handleStopGeneration}
            onEditAssistant={handleEditAssistant}
            onThinkingModeChange={handleThinkingModeChange}
            onRegenerate={handleRegenerate}
            providers={providers}
            models={models}
            citations={citations}
            kbSearchStatus={kbSearchStatus}
            assistantKbCacheRef={assistantKbCacheRef}
            conversationId={currentConversationId}
            conversationPrivacyMode={conversations.find(c => c.id === currentConversationId)?.privacy_mode || 0}
            deepThinkingMode={currentUIState.deepThinkingMode}
            onDeepThinkingChange={(mode) => setCurrentUIState({ deepThinkingMode: mode })}
            webSearchEnabled={currentUIState.webSearchEnabled}
            onWebSearchToggle={() => setCurrentUIState({ webSearchEnabled: !currentUIState.webSearchEnabled })}
            onTogglePrivacyMode={() => {
              if (!currentConversationId) return;
              const current = conversations.find(c => c.id === currentConversationId);
              const newMode = current?.privacy_mode ? 0 : 1;
              conversationsApi.update(currentConversationId, { privacy_mode: newMode }).then(c => {
                setConversations(prev => prev.map(x => x.id === c.id ? c : x));
              }).catch(() => {});
            }}
          />
        )}
      </div>

      <AssistantModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveAssistant}
        assistant={editingAssistant}
        providers={providers}
        models={models}
      />
    </div>
  );
}
