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
  model_name?: string | null;
  provider_name?: string | null;
  metrics?: MessageMetrics | null;
  aborted?: boolean;
  created_at: string;
  isStreaming?: boolean;
}

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
  error_message: string | null;
  processing_config: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  hash: string;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}
