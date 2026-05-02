import { FormEvent, useState, useRef, useEffect, useCallback } from 'react';
import type { Assistant, Message, Provider, Model } from '../types';
import { cn } from '../lib/utils';
import { Send, Paperclip, BrainCircuit, Book, User, Copy, RefreshCw, Check } from 'lucide-react';
import StreamingMarkdown from './shared/StreamingMarkdown';
import ThinkBlock from './shared/ThinkBlock';
import EmojiIcon from './shared/EmojiIcon';

interface ChatAreaProps {
  assistant: Assistant | null;
  messages: Message[];
  onSendMessage: (content: string) => void;
  isStreaming: boolean;
  onEditAssistant: (assistant: Assistant) => void;
  providers: Provider[];
  models: Model[];
  onRegenerate: (messageId: string) => void;
}

/** 格式化时间: YYYY-MM-DD HH:mm:ss */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

export default function ChatArea({
  assistant, messages, onSendMessage, isStreaming, onEditAssistant,
  providers, models, onRegenerate,
}: ChatAreaProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    onSendMessage(input.trim());
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

          {messages.filter(m => m.role !== 'system').map((message) => {
            const isUser = message.role === 'user';
            const time = message.created_at ? formatTime(message.created_at) : '';

            return (
              <div key={message.id} className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
                {/* 头像 */}
                <div className="mt-1 shrink-0">
                  {isUser ? (
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: '#22c55e' }}>
                      <User className="w-5 h-5" />
                    </div>
                  ) : (
                    <EmojiIcon emoji={assistant.emoji || '🤖'} size={32} fontSize={16} />
                  )}
                </div>

                <div className={cn("flex flex-col gap-1.5 flex-1 min-w-0", isUser ? "items-end" : "items-start")}>
                  {/* 发送者名称 */}
                  <span className="text-xs font-medium px-1" style={{ color: 'var(--color-text-2)' }}>
                    {isUser ? '用户' : assistantLabel}
                  </span>

                  {message.thought_process && (
                    <ThinkBlock content={message.thought_process} />
                  )}
                  {message.content && (
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
                  )}
                  {message.isStreaming && !message.content && (
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
                  )}

                  {/* 时间戳和操作按钮 */}
                  {time && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>{time}</span>
                      {!isUser && (
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => onRegenerate(message.id)}
                            className="p-1 rounded transition-colors hover:bg-black/5"
                            style={{ color: 'var(--color-text-3)' }}
                            title="重新生成"
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
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="absolute bottom-0 left-0 right-0 px-6 md:px-10 pb-4 pt-10 bg-gradient-to-t from-[var(--color-background)] via-[var(--color-background)] to-transparent">
        <div className="w-full">
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
                {/* 上下文轮数显示 */}
                <div className="flex items-center px-2.5 py-1.5 rounded-full text-xs"
                  style={{ color: usedRounds >= maxRounds ? 'var(--color-primary)' : 'var(--color-text-3)' }}>
                  {usedRounds}/{maxRounds}
                </div>
                <button type="button" className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>
                  <Book className="w-3 h-3" />
                  知识库
                </button>
              </div>
              <div className="flex gap-1.5 items-center">
                <button type="button" className="p-2 rounded-full transition-colors hover:bg-black/5"
                  style={{ color: 'var(--color-icon)' }}>
                  <Paperclip className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!input.trim() || isStreaming}
                  className={cn(
                    "p-2 rounded-full transition-colors flex items-center justify-center text-white w-8 h-8",
                    input.trim() && !isStreaming ? "opacity-100 hover:opacity-80" : "opacity-30 cursor-not-allowed"
                  )}
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  <Send className="w-3.5 h-3.5 ml-[-1px]" />
                </button>
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
