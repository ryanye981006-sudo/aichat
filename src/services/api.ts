// API 调用封装层

const BASE_URL = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

// ===== 助手 API =====
export const assistantsApi = {
  list: () => request<any[]>('/assistants'),
  get: (id: string) => request<any>(`/assistants/${id}`),
  create: (data: any) => request<any>('/assistants', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => request<any>(`/assistants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => request<any>(`/assistants/${id}`, { method: 'DELETE' }),
};

// ===== 对话 API =====
export const conversationsApi = {
  list: (assistantId?: string) => request<any[]>(`/conversations${assistantId ? `?assistantId=${assistantId}` : ''}`),
  create: (assistant_id: string, title?: string) => request<any>('/conversations', { method: 'POST', body: JSON.stringify({ assistant_id, title }) }),
  update: (id: string, title: string) => request<any>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  remove: (id: string) => request<any>(`/conversations/${id}`, { method: 'DELETE' }),
};

// ===== 消息 API =====
export const messagesApi = {
  list: (conversationId: string) => request<any[]>(`/messages?conversationId=${conversationId}`),
};

// ===== 提供商 API =====
export const providersApi = {
  list: () => request<any[]>('/providers'),
  create: (data: any) => request<any>('/providers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => request<any>(`/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => request<any>(`/providers/${id}`, { method: 'DELETE' }),
  test: (id: string) => request<any>(`/providers/${id}/test`, { method: 'POST' }),
  fetchModels: (id: string) => request<any>(`/providers/${id}/fetch-models`, { method: 'POST' }),
  testModels: (id: string) => request<any>(`/providers/${id}/test-models`, { method: 'POST' }),
  clearModels: (id: string) => request<any>(`/providers/${id}/models`, { method: 'DELETE' }),
};

// ===== 模型 API =====
export const modelsApi = {
  list: (providerId?: string) => request<any[]>(`/models${providerId ? `?providerId=${providerId}` : ''}`),
  create: (data: any) => request<any>('/models', { method: 'POST', body: JSON.stringify(data) }),
  remove: (id: string) => request<any>(`/models/${id}`, { method: 'DELETE' }),
};

// ===== 记忆 API =====
export const memoryApi = {
  getSettings: () => request<any>('/memory/settings'),
  updateSettings: (data: any) => request<any>('/memory/settings', { method: 'PUT', body: JSON.stringify(data) }),
  list: (search?: string) => request<any[]>(`/memory${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  search: (query: string) => request<any[]>('/memory/search', { method: 'POST', body: JSON.stringify({ query }) }),
  create: (content: string) => request<any>('/memory', { method: 'POST', body: JSON.stringify({ content }) }),
  history: (memoryId?: string) => request<any[]>(`/memory/history${memoryId ? `?memoryId=${memoryId}` : ''}`),
};

// ===== 知识库 API =====
export const knowledgeApi = {
  list: () => request<any[]>('/knowledge'),
  create: (data: any) => request<any>('/knowledge', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => request<any>(`/knowledge/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => request<any>(`/knowledge/${id}`, { method: 'DELETE' }),
  getDocuments: (kbId: string) => request<any[]>(`/knowledge/${kbId}/documents`),
  uploadDocument: (kbId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE_URL}/knowledge/${kbId}/documents`, { method: 'POST', body: formData }).then(r => r.json());
  },
  getChunks: (kbId: string, docId: string) => request<any[]>(`/knowledge/${kbId}/documents/${docId}/chunks`),
  search: (kbId: string, query: string, topK?: number, threshold?: number) =>
    request<any[]>(`/knowledge/${kbId}/search`, { method: 'POST', body: JSON.stringify({ query, topK, threshold }) }),
};

// ===== 聊天 SSE =====
export function chatSSE(
  assistantId: string,
  message: string,
  conversationId: string | null,
  callbacks: {
    onToken: (token: string) => void;
    onParsed: (thoughtProcess: string, displayContent: string) => void;
    onMeta: (conversationId: string) => void;
    onDone: (messageId: string, content: string, thoughtProcess: string | null) => void;
    onError: (error: string) => void;
  }
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: assistantId,
      conversation_id: conversationId,
      message,
    }),
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: '连接失败' }));
      callbacks.onError(err.error || '请求失败');
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError('无法读取响应流');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          switch (data.type) {
            case 'meta':
              callbacks.onMeta(data.conversation_id);
              break;
            case 'token':
              callbacks.onToken(data.content);
              break;
            case 'parsed':
              callbacks.onParsed(data.thoughtProcess, data.displayContent);
              break;
            case 'done':
              callbacks.onDone(data.message_id, data.content, data.thoughtProcess);
              break;
            case 'error':
              callbacks.onError(data.message);
              break;
          }
        } catch { /* 忽略解析错误 */ }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      callbacks.onError(err.message || '网络错误');
    }
  });

  return controller;
}

// ===== 重新生成 SSE =====
export function regenerateSSE(
  assistantId: string,
  conversationId: string,
  messageId: string,
  callbacks: {
    onToken: (token: string) => void;
    onParsed: (thoughtProcess: string, displayContent: string) => void;
    onDone: (messageId: string, content: string, thoughtProcess: string | null) => void;
    onError: (error: string) => void;
  }
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE_URL}/chat/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: assistantId,
      conversation_id: conversationId,
      message_id: messageId,
    }),
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: '连接失败' }));
      callbacks.onError(err.error || '请求失败');
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError('无法读取响应流');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          switch (data.type) {
            case 'token':
              callbacks.onToken(data.content);
              break;
            case 'parsed':
              callbacks.onParsed(data.thoughtProcess, data.displayContent);
              break;
            case 'done':
              callbacks.onDone(data.message_id, data.content, data.thoughtProcess);
              break;
            case 'error':
              callbacks.onError(data.message);
              break;
          }
        } catch { /* 忽略解析错误 */ }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      callbacks.onError(err.message || '网络错误');
    }
  });

  return controller;
}
