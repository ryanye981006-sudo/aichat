import { FormEvent, useState, useRef, useEffect, useCallback } from 'react';
import type { Assistant, Message, Provider, Model, KnowledgeBase, FileAttachment } from '../types';
import { cn } from '../lib/utils';
import { isReasoningModel } from '../lib/reasoning';
import { getFileCategory, checkFileAllowed, getSupportedExts } from '../lib/modelCapabilities';
import { knowledgeApi } from '../services/api';
import { Send, Paperclip, Book, User, Copy, RefreshCw, Check, ChevronDown, Square, AlertTriangle, X, Shield } from 'lucide-react';
import { Tooltip, message as antMessage } from 'antd';
import StreamingMarkdown from './shared/StreamingMarkdown';
import ThinkBlock from './shared/ThinkBlock';
import EmojiIcon from './shared/EmojiIcon';
import CitationBlock from './shared/CitationBlock';
import ToolCallBlock from './ToolCallBlock';
import DeepThinkingButton from './DeepThinkingButton';
import WebSearchToggleButton from './WebSearchToggleButton';

interface ChatAreaProps {
  assistant: Assistant | null;
  messages: Message[];
  onSendMessage: (content: string, thinkingMode: string, kbIds: string[], files?: FileAttachment[]) => void;
  isStreaming: boolean;
  onEditAssistant: (assistant: Assistant) => void;
  onThinkingModeChange?: (mode: string) => void;
  providers: Provider[];
  models: Model[];
  onStopGeneration?: () => void;
  onRegenerate: (messageId: string, thinkingMode: string, kbIds: string[]) => void;
  citations?: any[];
  kbSearchStatus?: string | null;
  assistantKbCacheRef: React.MutableRefObject<Record<string, string[]>>;
  conversationId?: string | null;
  conversationPrivacyMode?: number;
  onTogglePrivacyMode?: () => void;
  deepThinkingMode?: boolean;
  onDeepThinkingChange?: (mode: boolean) => void;
  webSearchEnabled?: boolean;
  onWebSearchToggle?: () => void;
}

/** 格式化时间: YYYY-MM-DD HH:mm:ss */
function formatTime(iso: string): string {
  // SQLite datetime('now') 存储 UTC 无时区标记（如 "2026-05-03 04:05:46"）
  // 前端 new Date().toISOString() 自带 "Z" 后缀
  // 对无时区的 SQLite 字符串附加 Z，让 JS 正确识别为 UTC 并转为本地时间
  const hasTz = iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z');
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

// 根据工具调用间的参数关联，计算每条工具调用的嵌套深度
function computeNestedToolCalls(toolCalls: any[]): { toolCall: any; depth: number }[] {
  const result: { toolCall: any; depth: number }[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    let depth = 0;

    // recall_context(memory_id) → 父节点是最近一条包含该 memory_id 的 search_memory 或 recall_context
    if (tc.toolName === 'recall_context' && tc.args?.memory_id) {
      const memId = tc.args.memory_id;
      for (let j = i - 1; j >= 0; j--) {
        const prev = toolCalls[j];
        const prevMemIds = extractMemoryIds(prev);
        if (prevMemIds.has(memId)) {
          depth = result[j].depth + 1;
          break;
        }
      }
    }

    // recall_sources(memory_id) → 父节点是最近一条包含该 memory_id 的工具调用
    if (tc.toolName === 'recall_sources' && tc.args?.memory_id) {
      const memId = tc.args.memory_id;
      for (let j = i - 1; j >= 0; j--) {
        const prev = toolCalls[j];
        const prevMemIds = extractMemoryIds(prev);
        if (prevMemIds.has(memId)) {
          depth = result[j].depth + 1;
          break;
        }
      }
    }

    // web_fetch(url) → 父节点是最近一条包含该 url 的 web_search
    if (tc.toolName === 'web_fetch' && tc.args?.url) {
      const fetchUrl = tc.args.url;
      for (let j = i - 1; j >= 0; j--) {
        const prev = toolCalls[j];
        if (prev.toolName === 'web_search') {
          const prevUrls = extractSearchUrls(prev);
          if (prevUrls.has(fetchUrl)) {
            depth = result[j].depth + 1;
            break;
          }
        }
      }
    }

    result.push({ toolCall: tc, depth });
  }

  return result;
}

// 从工具调用结果中提取所有 memory_id
function extractMemoryIds(tc: any): Set<string> {
  const ids = new Set<string>();
  if (!tc.result) return ids;

  // search_memory 返回记忆数组，每项有 memory_id
  if (tc.toolName === 'search_memory') {
    const items = Array.isArray(tc.result) ? tc.result : (tc.result?.raw || tc.result?.output);
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item.memory_id) ids.add(item.memory_id);
      }
    }
  }

  // recall_context/recall_sources 的参数中有 memory_id
  if (tc.args?.memory_id) {
    ids.add(tc.args.memory_id);
  }

  return ids;
}

// 从 web_search 结果中提取所有 URL
function extractSearchUrls(tc: any): Set<string> {
  const urls = new Set<string>();
  if (!tc.result) return urls;

  if (tc.toolName === 'web_search') {
    const items = Array.isArray(tc.result) ? tc.result : (tc.result?.raw || tc.result?.output);
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item.url) urls.add(item.url);
      }
    }
  }

  return urls;
}

export default function ChatArea({
  assistant, messages, onSendMessage, isStreaming, onStopGeneration, onEditAssistant, onThinkingModeChange,
  providers, models, onRegenerate, citations = [], kbSearchStatus, assistantKbCacheRef,
  conversationId, conversationPrivacyMode, onTogglePrivacyMode,
  deepThinkingMode = true, onDeepThinkingChange,
  webSearchEnabled = false, onWebSearchToggle,
}: ChatAreaProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // thinkingMode 从 deepThinkingMode prop 派生
  const thinkingMode = deepThinkingMode ? 'enabled' : 'disabled';

  // 知识库选择
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [showKbDropdown, setShowKbDropdown] = useState(false);
  const kbDropdownRef = useRef<HTMLDivElement>(null);
  const availableKbs = knowledgeBases.filter(kb => kb.document_count > 0);

  // 从缓存恢复 KB 选择，无缓存时默认不选择任何知识库
  const getCachedKbIds = (): string[] => {
    if (!assistant?.id) return [];
    return assistantKbCacheRef.current[assistant.id] || [];
  };
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>(getCachedKbIds);

  // 文件附件
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropAreaRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 助手切换时恢复缓存
  useEffect(() => {
    setSelectedKbIds(getCachedKbIds());
  }, [assistant?.id]);

  // 加载知识库列表
  useEffect(() => {
    knowledgeApi.list().then(kbs => setKnowledgeBases(kbs as KnowledgeBase[])).catch(() => {});
  }, [assistant?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (kbDropdownRef.current && !kbDropdownRef.current.contains(e.target as Node)) {
        setShowKbDropdown(false);
      }
    };
    if (showKbDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showKbDropdown]);

  // 读取文件为 dataUrl
  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 将 File → FileAttachment
  const fileToAttachment = async (file: File): Promise<FileAttachment> => {
    const ext = file.name.split('.').pop() || '';
    const category = getFileCategory(ext);
    const dataUrl = category === 'image' ? await readFileAsDataUrl(file) : '';
    return {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      dataUrl,
      category,
    };
  };

  // 验证文件是否被当前模型支持
  const validateFile = (file: File, model?: Model | null): string | null => {
    const ext = file.name.split('.').pop() || '';
    return checkFileAllowed(ext, model);
  };

  // 添加文件（含能力检查）
  const handleAddFiles = useCallback(async (files: FileList | File[]) => {
    if (!assistant) return;

    const model = models.find(m => m.id === assistant.model_id);
    const newAttachments: FileAttachment[] = [];
    let blockedCount = 0;

    for (const file of files) {
      const error = validateFile(file, model || null);
      if (error) {
        antMessage.warning(`${file.name}: ${error}`);
        blockedCount++;
        continue;
      }
      const attachment = await fileToAttachment(file);
      newAttachments.push(attachment);
    }

    if (newAttachments.length > 0) {
      setAttachedFiles(prev => [...prev, ...newAttachments]);
    }
  }, [assistant, models]);

  // 从 <input type="file"> 选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleAddFiles(e.target.files);
    }
    // 重置 input 以便重复选择同名文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 拖放处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  // 粘贴处理
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      handleAddFiles(imageFiles);
    }
  };

  // 移除已附加文件
  const removeAttachment = (fileId: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // 计算 accept 属性值
  const acceptExts = getSupportedExts(models.find(m => m.id === assistant?.model_id));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isStreaming) return;
    onSendMessage(input.trim() || '请分析下列文件', thinkingMode, selectedKbIds, attachedFiles.length > 0 ? attachedFiles : undefined);
    setInput('');
    setAttachedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // 解析助手的模型名和供应商名
  const model = models.find(m => m.id === assistant?.model_id);
  const provider = providers.find(p => p.id === (model?.provider_id || assistant?.provider_id));
  const assistantLabel = model
    ? `${model.display_name || model.name} | ${provider?.name || ''}`
    : assistant?.name || '助手';

  // 深度思考按钮显示与选项
  const currentModel = model;
  const showThinkButton = isReasoningModel(currentModel);

  // 计算当前实际发送给 LLM 的上下文轮数（后端会按 context_rounds 截断）
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const totalRounds = Math.ceil(nonSystemMessages.filter(m => m.role === 'user').length) + (input.trim() && !isStreaming ? 1 : 0);
  const maxRounds = assistant?.context_rounds || 10;
  const usedRounds = Math.min(totalRounds, maxRounds);

  // 复制消息内容
  const handleCopy = useCallback(async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback for non-clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  if (!assistant) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
        <div style={{ color: 'var(--color-text-3)' }}>请选择或新建一个助手以开始</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Header */}
      <div className="h-14 flex items-center px-5 shrink-0 border-b" style={{
        backgroundColor: 'var(--color-background-soft)',
        borderColor: 'var(--color-border)',
      }}>
        <button
          onClick={() => onEditAssistant(assistant)}
          className="flex items-center gap-2 px-2 py-1 -ml-2 rounded-lg transition-colors hover:bg-black/5"
          style={{ color: 'var(--color-text)' }}
        >
          <EmojiIcon emoji={assistant.emoji || '🤖'} size={24} fontSize={13} />
          <span className="font-semibold text-sm">{assistant.name}</span>
        </button>
        <div className="flex-1" />
        {conversationId && onTogglePrivacyMode && (
          <button
            onClick={onTogglePrivacyMode}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border",
              conversationPrivacyMode ? "bg-red-50 border-red-200" : "border-gray-200"
            )}
            style={{
              color: conversationPrivacyMode ? '#dc2626' : 'var(--color-text-2)',
            }}
            title={conversationPrivacyMode ? '隐私模式已开启，当前对话不会被提取为记忆' : '隐私模式已关闭'}
          >
            <Shield className="w-3 h-3" />
            {conversationPrivacyMode ? '隐私中' : '隐私'}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 md:px-10 py-6">
        <div className="w-full space-y-6 pb-24">
          {/* System Prompt */}
          <div
            onClick={() => onEditAssistant(assistant)}
            className="w-full p-4 rounded-xl text-sm cursor-pointer transition-all border hover:border-opacity-50"
            style={{
              backgroundColor: 'var(--color-background-soft)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-2)',
            }}
          >
            <div className="whitespace-pre-wrap line-clamp-3">{assistant.system_prompt || '点击设置提示词...'}</div>
          </div>

          {(() => {
            const nonSystemMessages = messages.filter(m => m.role !== 'system');
            const lastAiMsg = [...nonSystemMessages].reverse().find(m => m.role === 'assistant');
            return nonSystemMessages.map((message) => {
            const isUser = message.role === 'user';
            const isLatestAi = !isUser && message.id === lastAiMsg?.id;
            const time = message.created_at ? formatTime(message.created_at) : '';

            return (
              <div key={message.id} className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
                {/* 头像 */}
                <div className="mt-1 shrink-0">
                  {isUser ? (
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: '#12C175' }}>
                      <User className="w-5 h-5" />
                    </div>
                  ) : (
                    <EmojiIcon emoji={assistant.emoji || '🤖'} size={32} fontSize={16} />
                  )}
                </div>

                <div className={cn("flex flex-col gap-1.5 flex-1 min-w-0", isUser ? "items-end" : "items-start")}>
                  {/* 发送者名称 */}
                  <span className="text-xs font-medium px-1" style={{ color: 'var(--color-text-2)' }}>
                    {isUser ? '用户' : (message.model_name ? `${message.model_name} | ${message.provider_name || ''}` : assistantLabel)}
                  </span>

                  {/* 深度思考 + 工具调用：有 reasoningSegments 时交错渲染，否则回退旧布局 */}
                  {!isUser && message.reasoningSegments && message.reasoningSegments.length > 0 ? (
                    <ThinkBlock>
                      {(() => {
                        // 从交错片段中提取所有工具调用，计算嵌套深度
                        const allTc = message.reasoningSegments.filter(s => s.type === 'tool_call').map(s => s.toolCall);
                        const nested = computeNestedToolCalls(allTc);
                        const depthMap = new Map(nested.map(n => [n.toolCall.toolCallId, n.depth]));
                        return message.reasoningSegments.map((seg, i) =>
                          seg.type === 'reasoning' ? (
                            <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
                              {seg.text}
                            </div>
                          ) : (
                            <ToolCallBlock key={seg.toolCall.toolCallId} toolCall={seg.toolCall} depth={depthMap.get(seg.toolCall.toolCallId) ?? 0} />
                          )
                        );
                      })()}
                    </ThinkBlock>
                  ) : (
                    <>
                      {message.thought_process && (
                        <ThinkBlock content={message.thought_process} />
                      )}
                      {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
                        <div className="flex flex-col gap-0.5 w-full">
                          {computeNestedToolCalls(message.toolCalls).map(({ toolCall: tc, depth }) => (
                            <ToolCallBlock key={tc.toolCallId} toolCall={tc} depth={depth} />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {/* 消息气泡 */}
                  {message.content ? (
                    <div className={cn(
                      "px-4 py-3 rounded-2xl",
                      isUser
                        ? 'text-white rounded-tr-sm'
                        : 'rounded-tl-sm border'
                    )}
                    style={isUser ? {
                      backgroundColor: 'var(--color-primary)',
                    } : {
                      backgroundColor: 'var(--color-background-soft)',
                      borderColor: 'var(--color-border-soft)',
                      color: 'var(--color-text)',
                    }}>
                      {isUser ? (
                        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                      ) : (
                        <StreamingMarkdown content={message.content} isStreaming={message.isStreaming} />
                      )}
                    </div>
                  ) : message.isStreaming ? (
                    <div className="px-4 py-3 rounded-2xl rounded-tl-sm border" style={{
                      backgroundColor: 'var(--color-background-soft)',
                      borderColor: 'var(--color-border-soft)',
                    }}>
                      <div className="flex items-center gap-2" style={{ color: 'var(--color-text-3)' }}>
                        <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '300ms' }} />
                        {kbSearchStatus && (
                          <span className="text-sm">{kbSearchStatus}</span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* 中止气泡 —— 独立样式，有内容时显示在回复气泡下方，无内容时单独显示 */}
                  {!isUser && message.aborted && (
                    <div className="px-3 py-2 rounded-xl border" style={{
                      backgroundColor: '#fef2f2',
                      borderColor: '#fecaca',
                    }}>
                      <div className="flex items-center gap-1.5" style={{ color: '#dc2626' }}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs">请求被中止，可能由于超时、用户取消或服务器端主动中断导致。</span>
                      </div>
                    </div>
                  )}
                  {/* 时间戳、操作按钮和 Token 用量 —— 仅在消息生成完毕后显示 */}
                  {!message.isStreaming && time && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>{time}</span>
                      {!isUser && (
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => isLatestAi && onRegenerate(message.id, thinkingMode, selectedKbIds)}
                            disabled={!isLatestAi}
                            className="p-1 rounded transition-colors hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{ color: 'var(--color-text-3)' }}
                            title={isLatestAi ? '重新生成' : '仅最新回复可重新生成'}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleCopy(message.raw_content || message.content, message.id)}
                            className="p-1 rounded transition-colors hover:bg-black/5"
                            style={{ color: copiedId === message.id ? 'var(--color-primary)' : 'var(--color-text-3)' }}
                            title={copiedId === message.id ? '已复制' : '复制'}
                          >
                            {copiedId === message.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      )}
                      {/* Token 用量 — 显示在操作按钮右侧 */}
                      {!isUser && message.metrics && (
                        <Tooltip
                          title={`首字时延 ${message.metrics.ttftMs} ms | 每秒 ${message.metrics.tokensPerSecond} tokens`}
                          placement="top"
                        >
                          <span className="text-[11px] cursor-help" style={{ color: 'var(--color-text-3)' }}>
                            {message.metrics.totalTokens > 0
                              ? `Tokens:${message.metrics.totalTokens} ↑${message.metrics.promptTokens} ↓${message.metrics.completionTokens}`
                              : `TTFT: ${message.metrics.ttftMs}ms`}
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  )}
                  {/* 引用来源 —— 仅最后一条助手消息显示，统一由 gap-1.5 控制与时间戳间距 */}
                  {isLatestAi && citations.length > 0 && (
                    <CitationBlock citations={citations} />
                  )}
                </div>
              </div>
            );
          }
        );
      })()}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area — pointer-events-none 让渐变区域不阻挡下方消息的点击 */}
      <div className="absolute bottom-0 left-0 right-0 px-6 md:px-10 pb-4 pt-10 bg-gradient-to-t from-[var(--color-background)] via-[var(--color-background)] to-transparent pointer-events-none">
        <div className="w-full pointer-events-auto">
          <div className="rounded-2xl border shadow-sm transition-all flex flex-col"
            ref={dropAreaRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              backgroundColor: 'var(--color-background-soft)',
              borderColor: isDragOver ? 'var(--color-primary)' : 'var(--color-border)',
            }}>
            {/* 文件预览区 */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
                {attachedFiles.map((f) => (
                  <div key={f.id} className="relative group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs"
                    style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}>
                    {f.category === 'image' && f.dataUrl ? (
                      <img src={f.dataUrl} alt={f.name} className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: 'var(--color-background-soft)', color: 'var(--color-text-3)' }}>
                        {f.name.split('.').pop()?.toUpperCase().slice(0, 3) || 'FILE'}
                      </div>
                    )}
                    <span className="max-w-[120px] truncate" style={{ color: 'var(--color-text)' }}>{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(f.id)}
                      className="p-0.5 rounded-full hover:bg-red-100 transition-colors"
                    >
                      <X className="w-3 h-3" style={{ color: 'var(--color-text-3)' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="请输入消息... (Enter 发送, Shift+Enter 换行)"
              className="w-full resize-none bg-transparent py-3.5 px-4 outline-none text-sm placeholder:opacity-50"
              style={{
                color: 'var(--color-text)',
                minHeight: '56px',
                height: 'auto',
              }}
              rows={1}
            />
            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-1.5">
                {/* 深度思考按钮 */}
                <DeepThinkingButton
                  mode={deepThinkingMode}
                  onChange={(enabled) => {
                    onDeepThinkingChange?.(enabled);
                    onThinkingModeChange?.(enabled ? 'enabled' : 'disabled');
                  }}
                  visible={showThinkButton}
                />
                {/* 智能搜索按钮 */}
                <WebSearchToggleButton enabled={webSearchEnabled} onChange={() => onWebSearchToggle?.()} />
                {/* 知识库选择按钮 */}
                {availableKbs.length > 0 && (
                  <div className="relative" ref={kbDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowKbDropdown(!showKbDropdown)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border"
                      style={{
                        borderColor: selectedKbIds.length > 0 ? 'var(--color-primary)' : 'var(--color-border)',
                        color: selectedKbIds.length > 0 ? 'var(--color-primary)' : 'var(--color-text-2)',
                      }}
                    >
                      <Book className="w-3 h-3" />
                      {selectedKbIds.length > 0 ? `知识库(${selectedKbIds.length})` : '知识库'}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showKbDropdown && (
                      <div className="absolute bottom-full left-0 mb-1.5 rounded-xl border shadow-lg py-1 z-50 min-w-[240px]"
                        style={{
                          backgroundColor: 'var(--color-background)',
                          borderColor: 'var(--color-border)',
                        }}>
                        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                          <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>选择知识库</div>
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-3)' }}>仅显示已处理完成的知识库</div>
                        </div>
                        <div className="max-h-[220px] overflow-y-auto">
                          {availableKbs.map(kb => {
                            const isSelected = selectedKbIds.includes(kb.id);
                            return (
                              <button
                                key={kb.id}
                                type="button"
                                onClick={() => {
                                  setSelectedKbIds(prev => {
                                    const next = prev.includes(kb.id)
                                      ? prev.filter(id => id !== kb.id)
                                      : [...prev, kb.id];
                                    if (assistant) {
                                      assistantKbCacheRef.current[assistant.id] = next;
                                    }
                                    return next;
                                  });
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-black/5 transition-colors flex items-center gap-2"
                              >
                                <div className={cn(
                                  "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
                                  isSelected ? "border-primary" : "border-gray-300"
                                )}
                                style={{
                                  borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                                  backgroundColor: isSelected ? 'var(--color-primary)' : 'transparent',
                                }}>
                                  {isSelected && <span className="text-white text-[8px]">✓</span>}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{kb.name}</div>
                                  <div className="text-[10px] truncate" style={{ color: 'var(--color-text-3)' }}>
                                    {kb.document_count} 个文档 · TopK {kb.search_top_k}
                                    {kb.enable_rerank ? ' · 重排序' : ''}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {selectedKbIds.length > 0 && (
                          <div className="px-3 py-2 border-t flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
                            <span className="text-[10px]" style={{ color: 'var(--color-text-3)' }}>已选 {selectedKbIds.length} 个</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedKbIds([]);
                                if (assistant) {
                                  assistantKbCacheRef.current[assistant.id] = [];
                                }
                              }}
                              className="text-[10px] hover:underline" style={{ color: 'var(--color-text-3)' }}
                            >清空</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 items-center">
                {/* 上下文轮数 — 紧挨上传按钮左侧 */}
                <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs border"
                  style={{
                    backgroundColor: 'var(--color-background-soft)',
                    borderColor: 'var(--color-border)',
                    color: usedRounds >= maxRounds ? 'var(--color-primary)' : 'var(--color-text-3)'
                  }}>
                  <span>上下文</span>
                  <span className="font-bold">{usedRounds}/{maxRounds}</span>
                  <span>轮</span>
                </div>
                <Tooltip title="上传文件 (支持拖放和粘贴)">
                  <button type="button" className="p-2 rounded-full transition-colors hover:bg-black/5"
                    style={{ color: 'var(--color-icon)' }}
                    onClick={() => fileInputRef.current?.click()}>
                    <Paperclip className="w-4 h-4" />
                  </button>
                </Tooltip>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept={acceptExts.map(ext => ext.startsWith('.') ? ext : `.${ext}`).join(',')}
                  onChange={handleFileSelect}
                />
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={onStopGeneration}
                    className="p-2 rounded-full transition-colors flex items-center justify-center text-white w-8 h-8 hover:opacity-80"
                    style={{ backgroundColor: '#dc2626' }}
                    title="停止生成"
                  >
                    <Square className="w-3.5 h-3.5" fill="white" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!input.trim() && attachedFiles.length === 0}
                    className={cn(
                      "p-2 rounded-full transition-colors flex items-center justify-center text-white w-8 h-8",
                      (input.trim() || attachedFiles.length > 0) ? "opacity-100 hover:opacity-80" : "opacity-30 cursor-not-allowed"
                    )}
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    <Send className="w-3.5 h-3.5 ml-[-1px]" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="text-center text-xs mt-2" style={{ color: 'var(--color-text-3)' }}>
            内容由 AI 生成，请谨慎甄别
          </div>
        </div>
      </div>
    </div>
  );
}
