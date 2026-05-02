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
  const [isSettingsMode, setIsSettingsMode] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'model' | 'rag' | 'memory'>('model');
  const [sidebarTab, setSidebarTab] = useState<'assistants' | 'topics'>('assistants');

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

  const loadMessages = async (conversationId: string) => {
    try {
      const msgs = await messagesApi.list(conversationId);
      setMessages(msgs);
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

  // ===== 对话操作 =====
  const handleSelectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
    setIsSettingsMode(false);
    setMessages([]);
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
  const handleSendMessage = useCallback(async (content: string) => {
    if (!currentAssistantId || isStreaming) return;

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

    const hasMessages = messages.length > 0;
    if (!hasMessages) {
      conversationsApi.update(activeConvId!, content.slice(0, 30)).then(c => {
        setConversations(prev => prev.map(x => x.id === c.id ? c : x));
      }).catch(() => {});
    }

    let fullRawContent = '';

    chatSSE(currentAssistantId, content, activeConvId, {
      onMeta(convId) {
        if (convId !== activeConvId) {
          setCurrentConversationId(convId);
          activeConvId = convId;
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
      onDone(messageId, content, thoughtProcess) {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, id: messageId, content, thought_process: thoughtProcess, isStreaming: false }
            : m
        ));
        setIsStreaming(false);
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
      },
    });
  }, [currentAssistantId, currentConversationId, isStreaming, messages.length]);

  // ===== 重新生成 =====
  const handleRegenerate = useCallback(async (messageId: string) => {
    if (!currentAssistantId || !currentConversationId || isStreaming) return;

    const activeConvId = currentConversationId;

    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: '', raw_content: '', thought_process: null, isStreaming: true } : m
    ));
    setIsStreaming(true);

    let fullRawContent = '';

    regenerateSSE(currentAssistantId, activeConvId, messageId, {
      onToken(token) {
        fullRawContent += token;
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, raw_content: fullRawContent, content: fullRawContent } : m
        ));
      },
      onParsed(thoughtProcess, displayContent) {
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, thought_process: thoughtProcess, content: displayContent } : m
        ));
      },
      onDone(newMsgId, content, thoughtProcess) {
        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, id: newMsgId, content, thought_process: thoughtProcess, isStreaming: false }
            : m
        ));
        setIsStreaming(false);
        loadMessages(activeConvId);
      },
      onError(error) {
        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, content: `错误: ${error}`, isStreaming: false }
            : m
        ));
        setIsStreaming(false);
      },
    });
  }, [currentAssistantId, currentConversationId, isStreaming]);

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
            onEditAssistant={handleEditAssistant}
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
