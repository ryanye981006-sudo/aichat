import { FormEvent, useState, useRef, useEffect, useCallback } from 'react';
import type { Assistant, Message, Provider, Model } from '../types';
import { cn } from '../lib/utils';
import { isReasoningModel } from '../lib/reasoning';
import { Send, Paperclip, BrainCircuit, Book, User, Copy, RefreshCw, Check, ChevronDown, Square, AlertTriangle } from 'lucide-react';
import { Tooltip } from 'antd';
import StreamingMarkdown from './shared/StreamingMarkdown';
import ThinkBlock from './shared/ThinkBlock';
import EmojiIcon from './shared/EmojiIcon';

interface ChatAreaProps {
  assistant: Assistant | null;
  messages: Message[];
  onSendMessage: (content: string, thinkingMode: string) => void;
  isStreaming: boolean;
  onEditAssistant: (assistant: Assistant) => void;
  onThinkingModeChange?: (mode: string) => void;
  providers: Provider[];
  models: Model[];
  onStopGeneration?: () => void;
  onRegenerate: (messageId: string, thinkingMode: string) => void;
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

export default function ChatArea({
  assistant, messages, onSendMessage, isStreaming, onStopGeneration, onEditAssistant, onThinkingModeChange,
  providers, models, onRegenerate,
}: ChatAreaProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [thinkingMode, setThinkingMode] = useState<string>(assistant?.thinking_mode || 'default');
  const [showThinkDropdown, setShowThinkDropdown] = useState(false);
  const thinkDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // 同步 assistant 的 thinking_mode 变化
  useEffect(() => {
    if (assistant?.thinking_mode) {
      setThinkingMode(assistant.thinking_mode);
    }
  }, [assistant?.thinking_mode]);

  // 点击外部关闭深度思考下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (thinkDropdownRef.current && !thinkDropdownRef.current.contains(e.target as Node)) {
        setShowThinkDropdown(false);
      }
    };
    if (showThinkDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showThinkDropdown]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    onSendMessage(input.trim(), thinkingMode);
    setInput('');
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

  const thinkOptions = [
    { value: 'default', label: '默认' },
    { value: 'enabled', label: '开启' },
    { value: 'disabled', label: '关闭' },
  ];
  const currentThinkLabel = thinkOptions.find(o => o.value === thinkingMode)?.label || '默认';

  const handleThinkModeSelect = (mode: string) => {
    setThinkingMode(mode);
    setShowThinkDropdown(false);
    onThinkingModeChange?.(mode);
  };

  // 计算当前使用的上下文轮数
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const usedRounds = Math.ceil(nonSystemMessages.filter(m => m.role === 'user').length) + (input.trim() && !isStreaming ? 1 : 0);
  const maxRounds = assistant?.context_rounds || 10;

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

                  {message.thought_process && (
                    <ThinkBlock content={message.thought_process} />
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
                      <div className="flex items-center gap-1" style={{ color: 'var(--color-text-3)' }}>
                        <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-primary)', animationDelay: '300ms' }} />
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
                            onClick={() => isLatestAi && onRegenerate(message.id, thinkingMode)}
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
            style={{
              backgroundColor: 'var(--color-background-soft)',
              borderColor: 'var(--color-border)',
            }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
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
                {showThinkButton && (
                  <div className="relative" ref={thinkDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowThinkDropdown(!showThinkDropdown)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}
                    >
                      <BrainCircuit className="w-3 h-3" />
                      {currentThinkLabel}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showThinkDropdown && (
                      <div className="absolute bottom-full left-0 mb-1.5 rounded-xl border shadow-lg py-1 z-50 min-w-[200px]"
                        style={{
                          backgroundColor: 'var(--color-background)',
                          borderColor: 'var(--color-border)',
                        }}>
                        {thinkOptions.map(option => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => handleThinkModeSelect(option.value)}
                            className="w-full text-left px-4 py-2.5 hover:bg-black/5 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{option.label}</div>
                                <div className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
                                  {option.value === 'default' ? '按模型行为默认' : option.value === 'enabled' ? '强制开启深度思考' : '强制关闭深度思考'}
                                </div>
                              </div>
                              {thinkingMode === option.value && (
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button type="button" className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>
                  <Book className="w-3 h-3" />
                  知识库
                </button>
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
                <button type="button" className="p-2 rounded-full transition-colors hover:bg-black/5"
                  style={{ color: 'var(--color-icon)' }}>
                  <Paperclip className="w-4 h-4" />
                </button>
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
                    disabled={!input.trim()}
                    className={cn(
                      "p-2 rounded-full transition-colors flex items-center justify-center text-white w-8 h-8",
                      input.trim() ? "opacity-100 hover:opacity-80" : "opacity-30 cursor-not-allowed"
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
