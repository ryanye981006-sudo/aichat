import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import AssistantModal from './components/AssistantModal';
import AssistantSelectModal from './components/AssistantSelectModal';
import ModelSelectModal from './components/shared/ModelSelectModal';
import SettingsArea from './components/SettingsArea';
import WindowFrame from './components/WindowFrame';
import type { Assistant, Provider, Model, Conversation, Message, ConversationUIState, FileAttachment } from './types';
import { assistantsApi, conversationsApi, messagesApi, providersApi, modelsApi, chatSSE, chatFileApi, regenerateSSE } from './services/api';
import { generateId } from './lib/utils';
import { createStreamCallbacks } from './lib/streamCallbacks';
import { isVisionModel } from './lib/vision';

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
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'model' | 'memory' | 'knowledge' | 'tools' | 'pet'>('model');
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // 窗口预览模式（开发阶段模拟 Electron 窗口效果）
  const [isWindowedPreview, setIsWindowedPreview] = useState(false);

  // 会话级 UI 状态：深度思考 + 联网搜索（按会话缓存，切换重置）
  const [conversationUIState, setConversationUIState] = useState<Record<string, ConversationUIState>>({});

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [showAssistantSelectModal, setShowAssistantSelectModal] = useState(false);
  const [showModelSelect, setShowModelSelect] = useState(false);

  // 消息按会话维度缓存：流式生成中切出再切回时保留流式状态
  const messagesCacheRef = useRef<Record<string, Message[]>>({});
  // 当前会话 ID 的同步 ref：供 SSE 异步回调判断用户是否已切走
  const currentConversationIdRef = useRef(currentConversationId);
  currentConversationIdRef.current = currentConversationId;
  // 按会话维度保存 AbortController：切回后仍能停止后台 SSE
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  // 当前助手
  const currentAssistant = assistants.find(a => a.id === currentAssistantId) || null;

  // 当前助手的历史对话（按更新时间降序）
  const currentAssistantConversations = conversations
    .filter(c => c.assistant_id === currentAssistantId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

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
    setShowSettings(false);
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

  // ===== 模型切换（Header 面包屑点击 → ModelSelectModal） =====
  const handleSwitchModel = () => {
    if (!currentAssistant) return;
    setShowModelSelect(true);
  };

  const handleModelSelect = async (providerId: string, modelId: string) => {
    if (!currentAssistantId) return;
    try {
      const updated = await assistantsApi.update(currentAssistantId, { provider_id: providerId, model_id: modelId });
      setAssistants(prev => prev.map(a => a.id === updated.id ? updated : a));
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
    setShowSettings(false);

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
      setShowSettings(false);
    } catch (e) { console.error(e); }
  };

  // ===== 发送消息 =====
  const handleSendMessage = useCallback(async (content: string, thinkingMode: string = 'default', files?: FileAttachment[]) => {
    if (!currentAssistantId) return;

    // 只阻止当前活跃会话在流式时发送消息
    if (isStreaming && streamingConversationId === currentConversationId) return;

    // 预处理文件：文档/文本类文件需先上传到后端解析提取文本
    let processedFiles: FileAttachment[] | undefined = files;
    if (files && files.length > 0) {
      const currentAssistant = assistants.find(a => a.id === currentAssistantId);
      const currentModel = models.find(m => m.id === currentAssistant?.model_id);
      const visionModel = isVisionModel(currentModel);

      const uploadResults = await Promise.all(
        files.map(async (f) => {
          // 图片文件已有 dataUrl，无需上传
          if (f.category === 'image' && f.dataUrl) return f;
          // 文档/文本文件：上传到后端解析
          if (f._file) {
            try {
              const result = await chatFileApi.upload(f._file, visionModel);
              return { ...f, uploadResult: result };
            } catch (err: any) {
              console.error(`文件上传失败 ${f.name}:`, err);
              return { ...f, uploadResult: { filePath: '', fileName: f.name, mimeType: f.mimeType, extractedText: `[文件 ${f.name} 解析失败: ${err.message}]`, isScannedPdf: false } };
            }
          }
          return f;
        })
      );
      processedFiles = uploadResults;
    }

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

    const state = { fullRawContent: '', currentReasoning: '', reasoningSegments: [] as any[] };
    const activeConvRef = { current: activeConvId };

    const ctx = {
      messagesCacheRef, currentConversationIdRef, abortControllersRef,
      setMessages, setIsStreaming, setStreamingConversationId, setAbortController,
    };

    const callbacks = createStreamCallbacks(aiMsg.id, activeConvRef, state, ctx, {
      enableGhostFilter: true,
      onAfterDone: () => { if (currentAssistantId) loadConversations(currentAssistantId); },
    });

    const controller = chatSSE(currentAssistantId, content, activeConvId, thinkingMode, {
      ...callbacks,
      onMeta(convId) {
        if (convId !== activeConvRef.current) {
          if (activeConvRef.current === currentConversationIdRef.current) {
            setCurrentConversationId(convId);
            activeConvRef.current = convId;
            setStreamingConversationId(convId);
            currentConversationIdRef.current = convId;
          }
        }
      },
    }, processedFiles, { webSearchEnabled: currentUIState.webSearchEnabled });
    abortControllersRef.current[activeConvRef.current] = controller;
    setAbortController(controller);
  }, [currentAssistantId, currentConversationId, isStreaming, streamingConversationId, messages.length, assistants, models]);

  // ===== 重新生成 =====
  const handleRegenerate = useCallback(async (messageId: string, thinkingMode: string = 'default') => {
    if (!currentAssistantId || !currentConversationId) return;
    if (isStreaming && streamingConversationId === currentConversationId) return;

    const activeConvId = currentConversationId;

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

    const state = { fullRawContent: '', currentReasoning: '', reasoningSegments: [] as any[] };
    const activeConvRef = { current: activeConvId };

    const ctx = {
      messagesCacheRef, currentConversationIdRef, abortControllersRef,
      setMessages, setIsStreaming, setStreamingConversationId, setAbortController,
    };

    const callbacks = createStreamCallbacks(effectiveMessageId, activeConvRef, state, ctx, {
      onAfterDone: () => { if (currentAssistantId) loadConversations(currentAssistantId); },
    });

    const regenController = regenerateSSE(currentAssistantId, activeConvId, effectiveMessageId, thinkingMode, callbacks, { webSearchEnabled: currentUIState.webSearchEnabled });
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
    <WindowFrame
      showWindowFrame={true}
      isWindowed={isWindowedPreview}
      onToggleWindowed={() => setIsWindowedPreview(!isWindowedPreview)}
    >
      <div className="flex flex-col h-full flex-1" style={{ backgroundColor: 'var(--bg)', minWidth: 0 }}>
        <div className="flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
          <Sidebar
            conversations={currentAssistantConversations}
            currentConversationId={currentConversationId}
            onSelectConversation={handleSelectConversation}
            onCreateConversation={handleCreateConversation}
            onRemoveConversation={handleRemoveConversation}
            onOpenSettings={() => setShowSettings(true)}
            onSwitchAssistant={() => setShowAssistantSelectModal(true)}
          />
          <ChatArea
            assistant={currentAssistant}
            messages={messages}
            onSendMessage={handleSendMessage}
            isStreaming={isStreaming}
            onStopGeneration={handleStopGeneration}
            onEditAssistant={handleEditAssistant}
            onSwitchModel={handleSwitchModel}
            onThinkingModeChange={handleThinkingModeChange}
            onRegenerate={handleRegenerate}
            providers={providers}
            models={models}
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
        </div>

        {showSettings && (
          <SettingsArea
            activeTab={settingsTab}
            onClose={() => setShowSettings(false)}
          />
        )}

        <AssistantModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveAssistant}
          assistant={editingAssistant}
          providers={providers}
          models={models}
          onDelete={handleRemoveAssistant}
        />

        <AssistantSelectModal
          isOpen={showAssistantSelectModal}
          onClose={() => setShowAssistantSelectModal(false)}
          assistants={assistants}
          currentAssistantId={currentAssistantId}
          onSelectAssistant={handleSelectAssistant}
          onCreateAssistant={handleCreateAssistant}
        />

        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleModelSelect}
          providers={providers.filter(p => p.enabled)}
          models={models}
          currentModelId={currentAssistant?.model_id || ''}
        />
      </div>
    </WindowFrame>
  );
}
