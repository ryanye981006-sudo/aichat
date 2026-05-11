// 前端类型定义

export interface Assistant {
  id: string;
  name: string;
  system_prompt: string;
  emoji: string;
  model_id: string | null;
  provider_id: string | null;
  temperature: number;
  temperature_enabled: number;
  context_rounds: number;
  enable_memory: number;
  enable_web_search: number;
  knowledge_base_ids: string;
  thinking_mode: string;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  is_preset: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface Model {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_length: number;
  created_at: string;
}

export interface Conversation {
  id: string;
  assistant_id: string;
  title: string;
  privacy_mode: number;
  created_at: string;
  updated_at: string;
}

export interface MessageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ttftMs: number;
  tokensPerSecond: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  raw_content: string;
  thought_process: string | null;
  turn_index: number;
  memory_enabled: number;
  privacy_mode: number;
  model_name?: string | null;
  provider_name?: string | null;
  metrics?: MessageMetrics | null;
  citations?: any[] | null;
  aborted?: boolean;
  toolCalls?: ToolCallEntry[];
  reasoningSegments?: ReasoningSegment[];
  created_at: string;
  isStreaming?: boolean;
}

// 深度思考与工具调用的交错片段
export type ReasoningSegment =
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; toolCall: ToolCallEntry };

export interface MemorySettings {
  id: number;
  enabled: number;
  llm_provider_id: string | null;
  llm_model_id: string | null;
  embedding_provider_id: string | null;
  embedding_model_id: string | null;
  embedding_dimension: number;
  updated_at: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  embedding_provider_id: string | null;
  embedding_model_id: string | null;
  chunk_size: number;
  chunk_overlap: number;
  search_top_k: number;
  similarity_threshold: number;
  chunk_strategy: 'paragraph' | 'sentence' | 'recursive';
  enable_query_rewrite: number;
  enable_rerank: number;
  rerank_provider_id: string | null;
  rerank_model_id: string | null;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocument {
  id: string;
  knowledge_base_id: string;
  source_type: 'file' | 'url' | 'note';
  file_path: string | null;
  file_name: string;
  processing_status: 'pending' | 'loading' | 'chunking' | 'embedding' | 'completed' | 'error';
  chunk_count: number;
  recall_count: number;
  error_message: string | null;
  processing_config: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  topic: string | null;
  type: string;
  importance: number;
  status: 'active' | 'invalidated';
  access_count: number;
  last_accessed: string | null;
  hash?: string;
  is_deleted?: number;
  created_at: string;
  updated_at: string;
}

// 聊天文件附件
export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;         // "image/png" | "application/pdf" | ...
  dataUrl: string;          // 缩略图/预览 base64 data URL
  category: 'image' | 'document' | 'text';
}

// 后端文件上传响应
export interface ChatFileUploadResult {
  filePath: string;
  fileName: string;
  mimeType: string;
  extractedText: string;
  isScannedPdf: boolean;
  images?: { mimeType: string; dataUrl: string }[];
}

// 记忆长期模块新增类型

export interface ToolCallEntry {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'done' | 'error';
  startedAt?: string;
  completedAt?: string;
}

// 工具调用展示块（前端渲染用，含展示配置）
export interface ToolCallBlock {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  completedAt?: string;
}

// 会话级 UI 状态（按钮区，不持久化到 DB）
export interface ConversationUIState {
  deepThinkingMode: 'auto' | 'enabled' | 'disabled';
  webSearchEnabled: boolean;
}

export interface MemoryDetail {
  id: string;
  content: string;
  topic: string | null;
  type: string;
  importance: number;
  status: 'active' | 'invalidated';
  source_conversation_id: string | null;
  metadata: Record<string, unknown> | null;
  access_count: number;
  last_accessed: string | null;
  valid_from: string;
  valid_until: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
  sources?: MemorySource[];
}

export interface MemorySource {
  source_id: string;
  source_type: 'chunk' | 'message' | 'attachment' | 'web_retrieval';
  chunk_id: string;
  conversation_id?: string;
  turn_range?: [number, number];
}

export interface UserProfile {
  [key: string]: string;
}
