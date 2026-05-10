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

export interface Conversation {
  id: string;
  assistant_id: string;
  title: string;
  privacy_mode: number;
  created_at: string;
  updated_at: string;
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
  created_at: string;
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

export interface Memory {
  id: string;
  content: string;
  hash: string;
  embedding: string;
  source_conversation_id: string | null;
  type: string;
  topic: string | null;
  importance: number;
  metadata: string | null;
  status: 'active' | 'invalidated';
  superseded_by: string | null;
  valid_from: string;
  valid_until: string | null;
  is_deleted: number;
  access_count: number;
  last_accessed: string | null;
  created_at: string;
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
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  embedding: string;
  created_at: string;
}

export interface ChatCompletionRequest {
  conversation_id?: string;
  assistant_id: string;
  message: string;
}

// 记忆长期模块新增类型

export interface ConversationChunk {
  id: string;
  conversation_id: string;
  start_turn_index: number;
  end_turn_index: number;
  content: string;
  embedding: string;
  status: 'open' | 'closed' | 'extracting' | 'extracted';
  closed_at: string | null;
  extracted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkMessage {
  id: string;
  chunk_id: string;
  message_id: string;
  turn_index: number;
  role: string;
  created_at: string;
}

export interface MessageAttachment {
  id: string;
  message_id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  name: string;
  path: string;
  created_at: string;
}

export interface MessageWebRetrieval {
  id: string;
  message_id: string;
  url: string;
  title: string | null;
  snippet: string | null;
  created_at: string;
}

export interface MemorySourceLink {
  id: string;
  memory_id: string;
  chunk_id: string;
  source_type: 'chunk' | 'message' | 'attachment' | 'web_retrieval';
  source_id: string | null;
  relevance_score: number | null;
  created_at: string;
}

export interface UserProfileEntry {
  key: string;
  value: string;
  updated_at: string;
}

export interface FactExtraction {
  fact: string;
  topic?: string;
  action: 'ADD' | 'UPDATE' | 'DELETE';
  existing_id: string | null;
  importance?: number;  // LLM 提供的重要度评分 (0~1)，优先于启发式算法
}

export interface MemorySearchResult {
  memory_id: string;
  content: string;
  topic: string | null;
  type: string;
  created_at: string;
  importance: number;
  source_count: number;
}

export interface ToolCallEntry {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'done' | 'error';
  started_at?: string;
  completed_at?: string;
}

// 网页搜索相关类型
export interface SearchParams {
  query: string;
  maxResults?: number;
  timeRange?: 'NoLimit' | 'OneDay' | 'OneWeek' | 'OneMonth' | 'OneYear';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  summary?: string;
  publishedTime?: string;
  rerankScore?: number;
  hostname?: string;
  hostLogo?: string;
}

export interface PageContent {
  url: string;
  title: string;
  content: string;
  fetchedAt: string;
}

