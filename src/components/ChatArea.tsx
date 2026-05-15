import { FormEvent, useState, useRef, useEffect, useCallback } from 'react';
import type { Assistant, Message, Provider, Model, FileAttachment } from '../types';
import { cn } from '../lib/utils';
import { isReasoningModel } from '../lib/reasoning';
import { getFileCategory, checkFileAllowed, getSupportedExts } from '../lib/modelCapabilities';
import { Send, Paperclip, Copy, RefreshCw, Check, Square, AlertTriangle, X } from 'lucide-react';
import { Tooltip, message as antMessage } from 'antd';
import StreamingMarkdown from './shared/StreamingMarkdown';
import ThinkBlock from './shared/ThinkBlock';
import EmojiIcon from './shared/EmojiIcon';
import ToolCallBlock from './ToolCallBlock';

interface ChatAreaProps {
  assistant: Assistant | null;
  messages: Message[];
  onSendMessage: (content: string, thinkingMode: string, files?: FileAttachment[]) => void;
  isStreaming: boolean;
  onEditAssistant: (assistant: Assistant) => void;
  onThinkingModeChange?: (mode: string) => void;
  providers: Provider[];
  models: Model[];
  onStopGeneration?: () => void;
  onRegenerate: (messageId: string, thinkingMode: string) => void;
  conversationId?: string | null;
  conversationPrivacyMode?: number;
  onTogglePrivacyMode?: () => void;
  deepThinkingMode?: boolean;
  onDeepThinkingChange?: (mode: boolean) => void;
  webSearchEnabled?: boolean;
  onWebSearchToggle?: () => void;
}

/** 短时间格式 HH:mm */
function fmtShortTime(iso: string): string {
  const hasTz = iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z');
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 根据工具调用间的参数关联，计算每条工具调用的嵌套深度
function computeNestedToolCalls(toolCalls: any[]): { toolCall: any; depth: number }[] {
  const result: { toolCall: any; depth: number }[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    let depth = 0;
    if (tc.toolName === 'recall_context' && tc.args?.memory_id) {
      const memId = tc.args.memory_id;
      for (let j = i - 1; j >= 0; j--) {
        const prev = toolCalls[j];
        if (extractMemoryIds(prev).has(memId)) { depth = result[j].depth + 1; break; }
      }
    }
    if (tc.toolName === 'recall_sources' && tc.args?.memory_id) {
      const memId = tc.args.memory_id;
      for (let j = i - 1; j >= 0; j--) {
        const prev = toolCalls[j];
        if (extractMemoryIds(prev).has(memId)) { depth = result[j].depth + 1; break; }
      }
    }
    if (tc.toolName === 'web_fetch' && tc.args?.url) {
      const fetchUrl = tc.args.url;
      for (let j = i - 1; j >= 0; j--) {
        const prev = toolCalls[j];
        if (prev.toolName === 'web_search' && extractSearchUrls(prev).has(fetchUrl)) {
          depth = result[j].depth + 1; break;
        }
      }
    }
    result.push({ toolCall: tc, depth });
  }
  return result;
}

function extractMemoryIds(tc: any): Set<string> {
  const ids = new Set<string>();
  if (!tc.result) return ids;
  if (tc.toolName === 'search_memory') {
    const items = Array.isArray(tc.result) ? tc.result : (tc.result?.raw || tc.result?.output);
    if (Array.isArray(items)) for (const item of items) if (item.memory_id) ids.add(item.memory_id);
  }
  if (tc.args?.memory_id) ids.add(tc.args.memory_id);
  return ids;
}

function extractSearchUrls(tc: any): Set<string> {
  const urls = new Set<string>();
  if (!tc.result) return urls;
  if (tc.toolName === 'web_search') {
    const items = Array.isArray(tc.result) ? tc.result : (tc.result?.raw || tc.result?.output);
    if (Array.isArray(items)) for (const item of items) if (item.url) urls.add(item.url);
  }
  return urls;
}

export default function ChatArea({
  assistant, messages, onSendMessage, isStreaming, onStopGeneration, onEditAssistant, onThinkingModeChange,
  providers, models, onRegenerate,
  conversationId, conversationPrivacyMode, onTogglePrivacyMode,
  deepThinkingMode = true, onDeepThinkingChange,
  webSearchEnabled = false, onWebSearchToggle,
}: ChatAreaProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const thinkingMode = deepThinkingMode ? 'enabled' : 'disabled';

  // 文件附件
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropAreaRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const fileToAttachment = async (file: File): Promise<FileAttachment> => {
    const ext = file.name.split('.').pop() || '';
    const category = getFileCategory(ext);
    const dataUrl = category === 'image' ? await readFileAsDataUrl(file) : '';
    return {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name, size: file.size,
      mimeType: file.type || 'application/octet-stream', dataUrl, category,
    };
  };

  const validateFile = (file: File, model?: Model | null): string | null => {
    const ext = file.name.split('.').pop() || '';
    return checkFileAllowed(ext, model);
  };

  const handleAddFiles = useCallback(async (files: FileList | File[]) => {
    if (!assistant) return;
    const model = models.find(m => m.id === assistant.model_id);
    const newAttachments: FileAttachment[] = [];
    let blockedCount = 0;
    for (const file of files) {
      const error = validateFile(file, model || null);
      if (error) { antMessage.warning(`${file.name}: ${error}`); blockedCount++; continue; }
      newAttachments.push(await fileToAttachment(file));
    }
    if (newAttachments.length > 0) setAttachedFiles(prev => [...prev, ...newAttachments]);
  }, [assistant, models]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleAddFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (e.dataTransfer.files?.length) handleAddFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) handleAddFiles(imageFiles);
  };

  const removeAttachment = (fileId: string) => setAttachedFiles(prev => prev.filter(f => f.id !== fileId));

  const acceptExts = getSupportedExts(models.find(m => m.id === assistant?.model_id));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isStreaming) return;
    onSendMessage(input.trim() || '请分析下列文件', thinkingMode, attachedFiles.length > 0 ? attachedFiles : undefined);
    setInput(''); setAttachedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  // 自适应 textarea 高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [input]);

  const model = models.find(m => m.id === assistant?.model_id);
  const provider = providers.find(p => p.id === (model?.provider_id || assistant?.provider_id));
  const assistantLabel = model
    ? `${model.display_name || model.name} | ${provider?.name || ''}`
    : assistant?.name || '助手';
  const currentModel = model;
  const showThinkButton = isReasoningModel(currentModel);

  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const totalRounds = Math.ceil(nonSystemMessages.filter(m => m.role === 'user').length) + (input.trim() && !isStreaming ? 1 : 0);
  const maxRounds = assistant?.context_rounds || 10;
  const usedRounds = Math.min(totalRounds, maxRounds);

  const handleCopy = useCallback(async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  // ===== 空状态 =====
  if (!assistant) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--chat-bg)' }}>
        <div className="text-center space-y-3">
          <div
            className="w-14 h-14 mx-auto rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-dim)' }}
          >
            <span style={{ fontSize: 24, color: 'var(--accent)' }}>💬</span>
          </div>
          <div className="text-sm font-medium" style={{ color: 'var(--fg)' }}>开始新对话</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>请选择或新建一个助手以开始</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative" style={{
      background: 'linear-gradient(180deg, var(--chat-bg) 0%, #f0f3fa 100%)',
    }}>
      {/* ===== Header ===== */}
      <div
        className="h-14 flex items-center px-5 shrink-0 border-b gap-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={() => onEditAssistant(assistant)}
          className="flex items-center gap-3 px-1 py-1 rounded-lg transition-colors hover:opacity-80"
        >
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--accent-dim)' }}
          >
            <span style={{ fontSize: 15 }}>{assistant.emoji || '🤖'}</span>
          </div>
          <span
            className="font-semibold text-sm"
            style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}
          >
            {assistant.name}
          </span>
        </button>
        <span
          className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
          style={{
            backgroundColor: 'var(--hover-bg)',
            color: 'var(--muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {model?.display_name || model?.name || '未选择模型'}
        </span>
        <div className="flex-1" />

        {/* 隐私胶囊 */}
        {conversationId && onTogglePrivacyMode && (
          <button
            onClick={onTogglePrivacyMode}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold transition-all select-none border'
            )}
            style={{
              letterSpacing: '0.03em',
              backgroundColor: conversationPrivacyMode ? 'var(--accent)' : 'var(--chat-bg)',
              color: conversationPrivacyMode ? '#fff' : 'var(--muted)',
              borderColor: conversationPrivacyMode ? 'var(--accent)' : 'var(--border)',
              boxShadow: conversationPrivacyMode ? 'var(--shadow-button)' : 'none',
            }}
            title={conversationPrivacyMode ? '隐私模式已开启' : '隐私模式已关闭'}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: conversationPrivacyMode ? '#fff' : 'var(--muted-soft)' }}
            />
            {conversationPrivacyMode ? '隐私中' : '隐私'}
          </button>
        )}
      </div>

      {/* ===== Messages ===== */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="w-full space-y-6 pb-24" style={{ maxWidth: 768, margin: '0 auto' }}>
          {/* 系统提示词卡片 */}
          {nonSystemMessages.length === 0 && !isStreaming && (
            <div
              onClick={() => onEditAssistant(assistant)}
              className="w-full p-4 rounded-xl text-sm cursor-pointer transition-all border"
              style={{
                borderStyle: 'dashed',
                borderColor: 'var(--border)',
                color: 'var(--muted)',
                backgroundColor: 'var(--sidebar-bg)',
              }}
            >
              <div className="whitespace-pre-wrap line-clamp-3">{assistant.system_prompt || '点击设置提示词...'}</div>
            </div>
          )}

          {(() => {
            const nonSystemMsgs = messages.filter(m => m.role !== 'system');
            const lastAiMsg = [...nonSystemMsgs].reverse().find(m => m.role === 'assistant');
            return nonSystemMsgs.map((message) => {
              const isUser = message.role === 'user';
              const isLatestAi = !isUser && message.id === lastAiMsg?.id;
              const time = message.created_at ? fmtShortTime(message.created_at) : '';

              return (
                <div key={message.id} className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
                  {/* 头像 */}
                  <div className="mt-1 shrink-0">
                    {isUser ? (
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: 'var(--active-bg)', color: 'var(--fg)' }}
                      >
                        <span className="text-xs font-bold">我</span>
                      </div>
                    ) : (
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{
                          background: 'linear-gradient(135deg, var(--accent), #7b92ce)',
                          color: '#fff',
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{assistant.emoji || '🤖'}</span>
                      </div>
                    )}
                  </div>

                  <div className={cn("flex flex-col gap-1.5 flex-1 min-w-0", isUser ? "items-end" : "items-start")}>
                    {/* 发送者名称 + 时间 */}
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                        {isUser ? '用户' : (message.model_name ? `${message.model_name} | ${message.provider_name || ''}` : assistantLabel)}
                      </span>
                      <span
                        className="text-[11px] tabular-nums"
                        style={{ color: 'var(--muted-soft)', fontFamily: 'var(--font-mono)' }}
                      >
                        {time}
                      </span>
                    </div>

                    {/* 深度思考 + 工具调用 */}
                    {!isUser && (() => {
                      const hasSegments = message.reasoningSegments && message.reasoningSegments.length > 0;
                      const segReasoning = message.reasoningSegments?.filter(s => s.type === 'reasoning');
                      const segToolCalls = message.reasoningSegments?.filter(s => s.type === 'tool_call').map(s => s.toolCall);
                      const thinkText = (segReasoning && segReasoning.length > 0)
                        ? segReasoning.map(s => s.text).join('\n')
                        : message.thought_process;
                      const tcList = (segToolCalls && segToolCalls.length > 0) ? segToolCalls : (message.toolCalls || []);

                      if (!thinkText && tcList.length === 0) return null;

                      if (!thinkText) {
                        return (
                          <div className="flex flex-col gap-0.5 w-full">
                            {computeNestedToolCalls(tcList).map(({ toolCall: tc, depth }) => (
                              <ToolCallBlock key={tc.toolCallId} toolCall={tc} depth={depth} />
                            ))}
                          </div>
                        );
                      }

                      if (hasSegments) {
                        const allTc = message.reasoningSegments!.filter(s => s.type === 'tool_call').map(s => s.toolCall);
                        const nested = computeNestedToolCalls(allTc);
                        const depthMap = new Map(nested.map(n => [n.toolCall.toolCallId, n.depth]));
                        return (
                          <ThinkBlock>
                            {(!segReasoning || segReasoning.length === 0) && message.thought_process && (
                              <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                                {message.thought_process}
                              </div>
                            )}
                            {message.reasoningSegments!.map((seg, i) =>
                              seg.type === 'reasoning' ? (
                                <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                                  {seg.text}
                                </div>
                              ) : (
                                <ToolCallBlock key={seg.toolCall.toolCallId} toolCall={seg.toolCall} depth={depthMap.get(seg.toolCall.toolCallId) ?? 0} />
                              )
                            )}
                          </ThinkBlock>
                        );
                      }

                      return (
                        <ThinkBlock>
                          <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                            {thinkText}
                          </div>
                          {tcList.length > 0 && computeNestedToolCalls(tcList).map(({ toolCall: tc, depth }) => (
                            <ToolCallBlock key={tc.toolCallId} toolCall={tc} depth={depth} />
                          ))}
                        </ThinkBlock>
                      );
                    })()}

                    {/* 消息气泡 */}
                    {message.content ? (
                      <div
                        className="px-[18px] py-3.5 text-sm leading-[1.7]"
                        style={{
                          maxWidth: 720,
                          borderRadius: 'var(--radius-lg)',
                          backgroundColor: isUser ? 'var(--user-bubble)' : 'var(--ai-bubble)',
                          color: 'var(--fg)',
                        }}
                      >
                        {isUser ? (
                          <div className="whitespace-pre-wrap">{message.content}</div>
                        ) : (
                          <StreamingMarkdown content={message.content} isStreaming={message.isStreaming} />
                        )}
                      </div>
                    ) : message.isStreaming ? (
                      <div
                        className="px-[18px] py-4 flex items-center gap-1.5"
                        style={{
                          maxWidth: 720,
                          borderRadius: 'var(--radius-lg)',
                          backgroundColor: 'var(--ai-bubble)',
                        }}
                      >
                        <span className="dot-bounce w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)', animationDelay: '0ms' }} />
                        <span className="dot-bounce w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)', animationDelay: '150ms' }} />
                        <span className="dot-bounce w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)', animationDelay: '300ms' }} />
                      </div>
                    ) : null}

                    {/* 中止气泡 */}
                    {!isUser && message.aborted && (
                      <div
                        className="px-3 py-2 rounded-xl border flex items-center gap-1.5"
                        style={{
                          maxWidth: 720,
                          backgroundColor: 'rgba(212, 96, 106, 0.08)',
                          borderColor: 'rgba(212, 96, 106, 0.2)',
                        }}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--danger)' }} />
                        <span className="text-xs" style={{ color: 'var(--danger)' }}>请求被中止，可能由于超时、用户取消或服务端中断。</span>
                      </div>
                    )}

                    {/* 操作按钮 + Token 用量 */}
                    {!message.isStreaming && time && (
                      <div className="flex items-center gap-1.5 px-1">
                        {!isUser && (
                          <>
                            <button
                              onClick={() => isLatestAi && onRegenerate(message.id, thinkingMode)}
                              disabled={!isLatestAi}
                              className="p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              style={{ color: 'var(--muted-soft)' }}
                              title={isLatestAi ? '重新生成' : '仅最新回复可重新生成'}
                              onMouseEnter={e => { if (isLatestAi) (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--muted-soft)'}
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleCopy(message.raw_content || message.content, message.id)}
                              className="p-1 rounded transition-colors"
                              style={{ color: copiedId === message.id ? 'var(--accent)' : 'var(--muted-soft)' }}
                              title={copiedId === message.id ? '已复制' : '复制'}
                              onMouseEnter={e => { if (copiedId !== message.id) (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
                              onMouseLeave={e => { if (copiedId !== message.id) (e.currentTarget as HTMLElement).style.color = 'var(--muted-soft)'; }}
                            >
                              {copiedId === message.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </>
                        )}
                        {/* Token 用量 tooltip */}
                        {!isUser && message.metrics && (
                          <Tooltip
                            title={`首字时延 ${message.metrics.ttftMs} ms | 每秒 ${message.metrics.tokensPerSecond} tokens`}
                            placement="top"
                          >
                            <span
                              className="text-[11px] cursor-help tabular-nums px-1.5 py-0.5 rounded"
                              style={{
                                color: 'var(--muted-soft)',
                                fontFamily: 'var(--font-mono)',
                                backgroundColor: 'var(--border-soft)',
                              }}
                            >
                              {message.metrics.totalTokens > 0
                                ? `Tokens:${message.metrics.totalTokens} ↑${message.metrics.promptTokens} ↓${message.metrics.completionTokens}`
                                : `TTFT:${message.metrics.ttftMs}ms`}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            });
          })()}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ===== Input Area ===== */}
      <div
        className="absolute bottom-0 left-0 right-0 px-6 pb-4 pt-10 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, var(--chat-bg) 0%, var(--chat-bg) 40%, transparent 100%)',
        }}
      >
        <div className="w-full pointer-events-auto" style={{ maxWidth: 768, margin: '0 auto' }}>
          <div
            ref={dropAreaRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="rounded-2xl border transition-all flex flex-col"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: isDragOver ? 'var(--accent)' : 'var(--border)',
              boxShadow: 'var(--shadow-micro)',
            }}
          >
            {/* 文件预览 */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
                {attachedFiles.map(f => (
                  <div
                    key={f.id}
                    className="relative group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs"
                    style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)' }}
                  >
                    {f.category === 'image' && f.dataUrl ? (
                      <img src={f.dataUrl} alt={f.name} className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <div
                        className="w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: 'var(--hover-bg)', color: 'var(--muted)' }}
                      >
                        {f.name.split('.').pop()?.toUpperCase().slice(0, 3) || 'FILE'}
                      </div>
                    )}
                    <span className="max-w-[120px] truncate" style={{ color: 'var(--fg)' }}>{f.name}</span>
                    <button onClick={() => removeAttachment(f.id)} className="p-0.5 rounded-full hover:bg-red-100 transition-colors">
                      <X className="w-3 h-3" style={{ color: 'var(--muted)' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
              className="w-full resize-none bg-transparent py-3.5 px-4 outline-none text-sm placeholder:opacity-40"
              style={{
                color: 'var(--fg)',
                fontFamily: 'var(--font-body)',
                lineHeight: 1.65,
                minHeight: 68,
                maxHeight: '50vh',
              }}
              rows={1}
            />
            <div className="flex items-center gap-2 px-3 pb-3">
              {/* 深度思考 — 胶囊 */}
              {showThinkButton && (
                <ControlToggle
                  label="深度思考"
                  active={deepThinkingMode}
                  onChange={() => {
                    onDeepThinkingChange?.(!deepThinkingMode);
                    onThinkingModeChange?.(deepThinkingMode ? 'disabled' : 'enabled');
                  }}
                />
              )}
              {/* 联网搜索 — 胶囊 */}
              <ControlToggle
                label="联网搜索"
                active={webSearchEnabled}
                onChange={() => onWebSearchToggle?.()}
              />

              <div className="flex-1" />

              {/* 上下文轮数 */}
              <div
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors select-none tabular-nums',
                  usedRounds >= maxRounds && 'border-[var(--warn)]'
                )}
                style={{
                  fontFamily: 'var(--font-mono)',
                  backgroundColor: 'var(--chat-bg)',
                  borderColor: usedRounds >= maxRounds ? 'var(--warn)' : 'var(--border)',
                  color: usedRounds >= maxRounds ? 'var(--warn)' : 'var(--muted-soft)',
                }}
                title={`当前上下文 ${usedRounds}/${maxRounds} 轮`}
              >
                <span>上下文</span>
                <span className="font-bold" style={{ color: usedRounds >= maxRounds ? 'var(--warn)' : 'var(--fg)' }}>
                  {usedRounds}/{maxRounds}
                </span>
                <span>轮</span>
              </div>

              {/* 上传按钮 */}
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-medium transition-all select-none"
                style={{
                  backgroundColor: 'var(--chat-bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
                onClick={() => fileInputRef.current?.click()}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--muted)';
                }}
                title="上传文件（支持拖放和粘贴）"
              >
                <Paperclip className="w-3.5 h-3.5" />
                上传文件
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept={acceptExts.map(ext => ext.startsWith('.') ? ext : `.${ext}`).join(',')}
                onChange={handleFileSelect}
              />

              {/* 发送/停止按钮 */}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStopGeneration}
                  className="shrink-0 flex items-center justify-center rounded-lg border transition-all"
                  style={{
                    width: 36, height: 36,
                    backgroundColor: 'rgba(212,96,106,0.06)',
                    borderColor: 'var(--danger)',
                  }}
                  title="停止生成"
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--danger)';
                    (e.currentTarget as HTMLElement).querySelector('svg')!.style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(212, 96, 106, 0.06)';
                    (e.currentTarget as HTMLElement).querySelector('svg')!.style.color = 'var(--danger)';
                  }}
                >
                  <Square className="w-3.5 h-3.5" fill="currentColor" style={{ color: 'var(--danger)', transition: 'color 0.1s' }} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!input.trim() && attachedFiles.length === 0}
                  className="shrink-0 flex items-center justify-center rounded-lg transition-all disabled:opacity-25 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none"
                  style={{
                    width: 36, height: 36,
                    background: 'linear-gradient(135deg, var(--accent), #6a82ce)',
                    boxShadow: '0 2px 6px rgba(85,112,184,0.25)',
                  }}
                  onMouseEnter={e => {
                    if (!input.trim() && attachedFiles.length === 0) return;
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 10px rgba(85,112,184,0.4)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 6px rgba(85,112,184,0.25)';
                  }}
                  onMouseDown={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                  onMouseUp={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 10px rgba(85,112,184,0.4)';
                  }}
                >
                  <Send className="w-4 h-4 text-white" style={{ marginLeft: -1 }} />
                </button>
              )}
            </div>
          </div>
          <div className="text-center text-[11px] mt-2" style={{ color: 'var(--muted-soft)' }}>
            内容由 AI 生成，请谨慎甄别
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 控制胶囊（深度思考/联网搜索） =====
function ControlToggle({ label, active, onChange }: { label: string; active: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all select-none"
      style={{
        backgroundColor: active ? 'var(--accent)' : 'var(--chat-bg)',
        color: active ? '#fff' : 'var(--muted)',
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        boxShadow: active ? 'var(--shadow-button)' : 'none',
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
          (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLElement).style.color = 'var(--muted)';
        }
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: active ? '#fff' : 'var(--muted-soft)' }}
      />
      {label}
    </button>
  );
}
