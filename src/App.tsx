import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import AssistantModal from './components/AssistantModal';
import SettingsArea from './components/SettingsArea';
import type { Assistant, Provider, Model, Conversation, Message } from './types';
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
  const [settingsTab, setSettingsTab] = useState<'model' | 'rag' | 'memory'>('model');
  const [sidebarTab, setSidebarTab] = useState<'assistants' | 'topics'>('assistants');
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);

  // ===== 初始化加载 =====
  useEffect(() => {
    loadInitialData();
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

  // 将服务端扁平列转换为前端 metrics 对象
  const normalizeMessageMetrics = (msg: any): Message => {
    if (msg.metrics) return msg; // 已经是 metrics 对象
    const promptTokens = msg.prompt_tokens ?? 0;
    const completionTokens = msg.completion_tokens ?? 0;
    // 只有确实有 token 数据时才生成 metrics（排除全 NULL 或全 0 的情况）
    if (promptTokens > 0 || completionTokens > 0) {
      return {
        ...msg,
        metrics: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          ttftMs: msg.ttft_ms ?? 0,
          tokensPerSecond: msg.tokens_per_second ?? 0,
        },
      };
    }
    return msg;
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const msgs = await messagesApi.list(conversationId);
      setMessages(msgs.map(normalizeMessageMetrics));
    } catch (e) { console.error(e); }
  };

  // ===== 助手操作 =====
  const handleSelectAssistant = useCallback(async (id: string) => {
    setCurrentAssistantId(id);
    setSidebarTab('topics');
    setIsSettingsMode(false);
    try {
      const convs = await conversationsApi.list(id);
      setConversations(convs);
      if (convs.length > 0) {
        const latest = convs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
        setCurrentConversationId(latest.id);
        loadMessages(latest.id);
      } else {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error(e);
      setCurrentConversationId(null);
      setMessages([]);
    }
  }, []);

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
    setCurrentConversationId(id);
    setIsSettingsMode(false);
    loadMessages(id);
    const conv = conversations.find(c => c.id === id);
    if (conv) {
      setCurrentAssistantId(conv.assistant_id);
    }
  }, [conversations]);

  const handleCreateConversation = async () => {
    if (!currentAssistantId) return;
    try {
      const conv = await conversationsApi.create(currentAssistantId, '新话题');
      setConversations(prev => [conv, ...prev]);
      setCurrentConversationId(conv.id);
      setMessages([]);
      setIsSettingsMode(false);
    } catch (e) { console.error(e); }
  };

  // ===== 发送消息 =====
  const handleSendMessage = useCallback(async (content: string, thinkingMode: string = 'default') => {
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
      created_at: new Date().toISOString(),
    };

    const aiMsg: Message = {
      id: `temp-${generateId()}`,
      conversation_id: activeConvId,
      role: 'assistant',
      content: '',
      raw_content: '',
      thought_process: null,
      created_at: new Date().toISOString(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setIsStreaming(true);
    setStreamingConversationId(activeConvId);

    const hasMessages = messages.length > 0;
    if (!hasMessages) {
      conversationsApi.update(activeConvId!, content.slice(0, 30)).then(c => {
        setConversations(prev => prev.map(x => x.id === c.id ? c : x));
      }).catch(() => {});
    }

    let fullRawContent = '';
    let currentReasoning = '';

    const controller = chatSSE(currentAssistantId, content, activeConvId, thinkingMode, {
      onMeta(convId) {
        if (convId !== activeConvId) {
          setCurrentConversationId(convId);
          activeConvId = convId;
          setStreamingConversationId(convId);
        }
      },
      onToken(token) {
        fullRawContent += token;
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, raw_content: fullRawContent, content: fullRawContent } : m
        ));
      },
      onParsed(thoughtProcess, displayContent) {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, thought_process: thoughtProcess, content: displayContent } : m
        ));
      },
      onReasoning(token: string) {
        currentReasoning += token;
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, thought_process: currentReasoning } : m
        ));
      },
      onDone(messageId, content, thoughtProcess, metrics, aborted) {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, id: messageId, content, thought_process: thoughtProcess, metrics: metrics || null, aborted: aborted || false, isStreaming: false }
            : m
        ));
        setIsStreaming(false);
        setStreamingConversationId(null);
        setAbortController(null);
        if (activeConvId) loadMessages(activeConvId);
        if (currentAssistantId) loadConversations(currentAssistantId);
      },
      onError(error) {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, content: `错误: ${error}`, isStreaming: false }
            : m
        ));
        setIsStreaming(false);
        setStreamingConversationId(null);
        setAbortController(null);
      },
    });
    setAbortController(controller);
  }, [currentAssistantId, currentConversationId, isStreaming, streamingConversationId, messages.length]);

  // ===== 重新生成 =====
  const handleRegenerate = useCallback(async (messageId: string, thinkingMode: string = 'default') => {
    if (!currentAssistantId || !currentConversationId) return;
    if (isStreaming && streamingConversationId === currentConversationId) return;

    const activeConvId = currentConversationId;

    // 立即隐藏旧消息并显示 loading，不等服务端响应
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: '', raw_content: '', thought_process: null, isStreaming: true, aborted: false, metrics: undefined } : m
    ));
    setIsStreaming(true);
    setStreamingConversationId(activeConvId);

    let effectiveMessageId = messageId;

    // 如果消息 ID 是临时的（被终止的消息），先从服务端加载获取真实 ID
    if (messageId.startsWith('temp-')) {
      try {
        const msgs = await messagesApi.list(activeConvId);
        const normalized = msgs.map(normalizeMessageMetrics);

        const lastAi = [...normalized].reverse().find(m => m.role === 'assistant');
        if (!lastAi || lastAi.id.startsWith('temp-')) {
          setIsStreaming(false);
          setStreamingConversationId(null);
          return;
        }
        effectiveMessageId = lastAi.id;
        // 用服务端真实记录替换 temp ID 消息，清空内容并保持 streaming 状态
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...lastAi, content: '', raw_content: '', thought_process: null, isStreaming: true, aborted: false, metrics: undefined } : m
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
          const normalized = msgs.map(normalizeMessageMetrics);
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

    const regenController = regenerateSSE(currentAssistantId, activeConvId, effectiveMessageId, thinkingMode, {
      onToken(token) {
        fullRawContent += token;
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId ? { ...m, raw_content: fullRawContent, content: fullRawContent, aborted: false } : m
        ));
      },
      onParsed(thoughtProcess, displayContent) {
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId ? { ...m, thought_process: thoughtProcess, content: displayContent, aborted: false } : m
        ));
      },
      onReasoning(token) {
        currentReasoning += token;
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId ? { ...m, thought_process: currentReasoning } : m
        ));
      },
      onDone(newMsgId, content, thoughtProcess, metrics, aborted) {
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId
            ? { ...m, id: newMsgId, content, thought_process: thoughtProcess, metrics: metrics || null, aborted: aborted || false, isStreaming: false }
            : m
        ));
        setIsStreaming(false);
        setStreamingConversationId(null);
        setAbortController(null);
        loadMessages(activeConvId);
      },
      onError(error) {
        setMessages(prev => prev.map(m =>
          m.id === effectiveMessageId
            ? { ...m, content: `错误: ${error}`, isStreaming: false }
            : m
        ));
        setIsStreaming(false);
        setStreamingConversationId(null);
        setAbortController(null);
      },
    });
    setAbortController(regenController);
  }, [currentAssistantId, currentConversationId, isStreaming, streamingConversationId, messages]);

  // ===== 停止生成 =====
  const handleStopGeneration = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsStreaming(false);
      setStreamingConversationId(null);
      setMessages(prev => prev.map(m =>
        m.isStreaming ? { ...m, isStreaming: false, aborted: true } : m
      ));
    }
  }, [abortController]);

  // ===== 深度思考模式切换 =====
  const handleThinkingModeChange = useCallback(async (mode: string) => {
    if (!currentAssistantId) return;
    try {
      const updated = await assistantsApi.update(currentAssistantId, { thinking_mode: mode });
      setAssistants(prev => prev.map(a => a.id === updated.id ? updated : a));
    } catch (e) { console.error(e); }
  }, [currentAssistantId]);

  const currentAssistant = assistants.find(a => a.id === currentAssistantId) || null;

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
