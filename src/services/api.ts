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
  update: (id: string, data: { title?: string; privacy_mode?: number }) => request<any>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
  test: (id: string, modelId: string) => request<any>(`/providers/${id}/test`, { method: 'POST', body: JSON.stringify({ model_id: modelId }) }),
  fetchModels: (id: string) => request<any>(`/providers/${id}/fetch-models`, { method: 'POST' }),
  testModels: (id: string) => request<any>(`/providers/${id}/test-models`, { method: 'POST' }),
  clearModels: (id: string) => request<any>(`/providers/${id}/models`, { method: 'DELETE' }),
  validateModel: (providerId: string, modelName: string) =>
    request<{ valid: boolean; error?: string }>(`/providers/${providerId}/validate-model`, { method: 'POST', body: JSON.stringify({ model_name: modelName }) }),
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
  list: (search?: string, status?: string) => request<any[]>(`/memory${search ? `?search=${encodeURIComponent(search)}` : ''}${status ? `${search ? '&' : '?'}status=${status}` : ''}`),
  search: (query: string, limit?: number) => request<any[]>('/memory/search', { method: 'POST', body: JSON.stringify({ query, limit }) }),
  create: (content: string) => request<any>('/memory', { method: 'POST', body: JSON.stringify({ content }) }),
  getDetail: (id: string) => request<any>(`/memory/${id}`),
  getSources: (id: string) => request<any[]>(`/memory/${id}/sources`),
  update: (id: string, content: string) => request<any>(`/memory/${id}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  remove: (id: string) => request<any>(`/memory/${id}`, { method: 'DELETE' }),
  history: (memoryId?: string) => request<any[]>(`/memory/history${memoryId ? `?memoryId=${memoryId}` : ''}`),
};

// ===== 个人信息 API =====
export const profileApi = {
  list: () => request<any[]>('/profile'),
  update: (data: Record<string, string>) => request<any[]>('/profile', { method: 'PUT', body: JSON.stringify(data) }),
  remove: (key: string) => request<any>(`/profile/${key}`, { method: 'DELETE' }),
};

// ===== 聊天文件上传 API =====
// ===== 全局设置 API =====
export const settingsApi = {
  getIqsKey: () => request<{ configured: boolean; masked: string }>('/settings/iqs-key'),
  updateIqsKey: (apiKey: string) => request<{ success: boolean; configured: boolean }>('/settings/iqs-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
};

export const chatFileApi = {
  upload: (file: File, isVisionModel: boolean) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('isVisionModel', String(isVisionModel));
    return fetch(`${BASE_URL}/chat/upload-file`, { method: 'POST', body: formData }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '文件上传失败');
      return data as import('../types').ChatFileUploadResult;
    });
  },
};

// ===== 聊天 SSE =====
export function chatSSE(
  assistantId: string,
  message: string,
  conversationId: string | null,
  thinkingMode: string = 'default',
  callbacks: {
    onToken: (token: string) => void;
    onParsed: (thoughtProcess: string, displayContent: string) => void;
    onMeta: (conversationId: string, citations?: any[]) => void;
    onDone: (messageId: string, content: string, thoughtProcess: string | null, metrics?: any, aborted?: boolean) => void;
    onError: (error: string) => void;
    onReasoning?: (token: string) => void;
    onStatus?: (message: string) => void;
    onToolCall?: (toolCallId: string, toolName: string, args: any) => void;
    onToolResult?: (toolCallId: string, toolName: string, result: any) => void;
    onStepStart?: (step: number) => void;
  },
  files?: import('../types').FileAttachment[],
  options?: { webSearchEnabled?: boolean; memoryEnabled?: boolean },
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: assistantId,
      conversation_id: conversationId,
      message,
      thinking_mode: thinkingMode,
      files: files,
      web_search_enabled: options?.webSearchEnabled,
      memory_enabled: options?.memoryEnabled,
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
              callbacks.onMeta(data.conversation_id, data.citations);
              break;
            case 'status':
              callbacks.onStatus?.(data.message);
              break;
            case 'token':
              callbacks.onToken(data.content);
              break;
            case 'reasoning':
              callbacks.onReasoning?.(data.content);
              break;
            case 'parsed':
              callbacks.onParsed(data.thoughtProcess, data.displayContent);
              break;
            case 'done':
              callbacks.onDone(data.message_id, data.content, data.thoughtProcess, data.metrics, data.aborted);
              break;
            case 'error':
              callbacks.onError(data.message);
              break;
            case 'tool_call':
              callbacks.onToolCall?.(data.toolCallId, data.toolName, data.args);
              break;
            case 'tool_result':
              callbacks.onToolResult?.(data.toolCallId, data.toolName, data.result);
              break;
            case 'step_start':
              callbacks.onStepStart?.(data.step);
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
  thinkingMode: string = 'default',
  callbacks: {
    onToken: (token: string) => void;
    onParsed: (thoughtProcess: string, displayContent: string) => void;
    onDone: (messageId: string, content: string, thoughtProcess: string | null, metrics?: any, aborted?: boolean) => void;
    onError: (error: string) => void;
    onReasoning?: (token: string) => void;
    onMeta?: (conversationId: string, citations?: any[]) => void;
    onStatus?: (message: string) => void;
    onToolCall?: (toolCallId: string, toolName: string, args: any) => void;
    onToolResult?: (toolCallId: string, toolName: string, result: any) => void;
    onStepStart?: (step: number) => void;
  },
  options?: { webSearchEnabled?: boolean; memoryEnabled?: boolean },
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE_URL}/chat/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: assistantId,
      conversation_id: conversationId,
      message_id: messageId,
      thinking_mode: thinkingMode,
      web_search_enabled: options?.webSearchEnabled,
      memory_enabled: options?.memoryEnabled,
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
              callbacks.onMeta?.(data.conversation_id, data.citations);
              break;
            case 'status':
              callbacks.onStatus?.(data.message);
              break;
            case 'token':
              callbacks.onToken(data.content);
              break;
            case 'reasoning':
              callbacks.onReasoning?.(data.content);
              break;
            case 'parsed':
              callbacks.onParsed(data.thoughtProcess, data.displayContent);
              break;
            case 'done':
              callbacks.onDone(data.message_id, data.content, data.thoughtProcess, data.metrics, data.aborted);
              break;
            case 'error':
              callbacks.onError(data.message);
              break;
            case 'tool_call':
              callbacks.onToolCall?.(data.toolCallId, data.toolName, data.args);
              break;
            case 'tool_result':
              callbacks.onToolResult?.(data.toolCallId, data.toolName, data.result);
              break;
            case 'step_start':
              callbacks.onStepStart?.(data.step);
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
