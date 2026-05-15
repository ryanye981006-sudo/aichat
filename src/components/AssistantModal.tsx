// 助手编辑弹窗（v2 新设计）— 保留全部功能：温度/轮数/深度思考/模型选择器/Emoji选择器
import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import type { Assistant, Provider, Model } from '../types';
import { cn } from '../lib/utils';
import { isReasoningModel } from '../lib/reasoning';
import EmojiIcon from './shared/EmojiIcon';
import EmojiPicker from './shared/EmojiPicker';
import ModelSelectModal from './shared/ModelSelectModal';
import { Toggle, BtnPrimary, BtnSecondary, BtnDanger } from './shared/Primitives';

interface AssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Assistant>) => void;
  assistant?: Assistant | null;
  providers: Provider[];
  models: Model[];
  onDelete?: (id: string) => void;
}

const DEFAULT_EMOJIS = ['🤖', '🐱', '⚡', '✨', '🔥', '🌟', '🚀', '💡', '🎯', '🌈'];

function getNextDefaultEmoji(): string {
  return DEFAULT_EMOJIS[Math.floor(Date.now() / 1000) % DEFAULT_EMOJIS.length];
}

export default function AssistantModal({ isOpen, onClose, onSave, assistant, providers, models, onDelete }: AssistantModalProps) {
  const [activeTab, setActiveTab] = useState<'prompt' | 'model'>('prompt');
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [emoji, setEmoji] = useState('🤖');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [temperatureEnabled, setTemperatureEnabled] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [contextRounds, setContextRounds] = useState(10);
  const [thinkingMode, setThinkingMode] = useState('default');
  const [showModelSelect, setShowModelSelect] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (assistant) {
        setName(assistant.name);
        setSystemPrompt(assistant.system_prompt);
        setEmoji(assistant.emoji || '🤖');
        setProviderId(assistant.provider_id || '');
        setModelId(assistant.model_id || '');
        setTemperatureEnabled(!!assistant.temperature_enabled);
        setTemperature(assistant.temperature ?? 0.7);
        setContextRounds(assistant.context_rounds ?? 10);
        setThinkingMode(assistant.thinking_mode || 'default');
      } else {
        setName('');
        setSystemPrompt('');
        setEmoji(getNextDefaultEmoji());
        const firstProvider = providers[0];
        setProviderId(firstProvider?.id || '');
        const firstProviderModels = models.filter(m => m.provider_id === firstProvider?.id);
        setModelId(firstProviderModels[0]?.id || '');
        setTemperatureEnabled(false);
        setTemperature(0.7);
        setContextRounds(10);
        setThinkingMode('default');
      }
      setActiveTab('prompt');
      setShowEmojiPicker(false);
    }
  }, [assistant, isOpen, providers]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name,
      system_prompt: systemPrompt,
      emoji,
      provider_id: providerId || null,
      model_id: modelId || null,
      temperature_enabled: temperatureEnabled ? 1 : 0,
      temperature,
      context_rounds: contextRounds,
      thinking_mode: thinkingMode,
    });
    onClose();
  };

  const isEditing = !!assistant;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(50, 58, 85, 0.4)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-[18px] w-full max-w-[520px] flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col max-h-[80vh]">
          {/* Header */}
          <div
            className="px-6 py-4 flex justify-between items-center border-b shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <h3
              className="text-[17px] font-semibold flex items-center gap-2"
              style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}
            >
              <EmojiIcon emoji={emoji} size={28} fontSize={15} />
              {isEditing ? '编辑助手' : '新建助手'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-[30px] h-[30px] flex items-center justify-center rounded-lg transition-colors border"
              style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent-dim)';
                (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = 'var(--muted)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Body: left tabs + right content */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left Tab Nav */}
            <div
              className="w-[120px] flex flex-col py-2 px-2 shrink-0 border-r gap-0.5"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--sidebar-bg)' }}
            >
              {[
                { key: 'prompt' as const, label: '提示词设置' },
                { key: 'model' as const, label: '模型设置' },
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  className="text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: activeTab === tab.key ? 'var(--accent-dim)' : 'transparent',
                    color: activeTab === tab.key ? 'var(--accent)' : 'var(--muted)',
                  }}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Right Content */}
            <div className="flex-1 overflow-y-auto p-5" style={{ backgroundColor: 'var(--chat-bg)' }}>
              {activeTab === 'prompt' && (
                <div className="space-y-4">
                  {/* 名称 */}
                  <FormGroup label="名称">
                    <FormInput_ value={name} onChange={setName} placeholder="例如：代码审查专家" autoFocus required />
                  </FormGroup>

                  {/* 提示词 */}
                  <FormGroup label="系统提示词">
                    <FormTextarea_
                      value={systemPrompt}
                      onChange={setSystemPrompt}
                      rows={8}
                      placeholder="设定助手的角色、能力和行为规范..."
                    />
                  </FormGroup>

                  {/* Emoji */}
                  <FormGroup label="头像 Emoji">
                    <div className="flex items-center gap-2 mb-2">
                      {DEFAULT_EMOJIS.map((e, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setEmoji(e)}
                          className={cn(
                            'w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all',
                            emoji === e ? 'ring-2 scale-110' : 'hover:bg-black/5'
                          )}
                          style={{
                            backgroundColor: emoji === e ? 'var(--accent-dim)' : 'var(--surface)',
                            color: emoji === e ? 'var(--accent)' : undefined,
                          }}
                        >
                          {e}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-medium transition-colors hover:bg-black/5 border"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                        title="更多"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {showEmojiPicker && (
                      <div className="relative" style={{ zIndex: 60 }}>
                        <div className="absolute bottom-full left-0 mb-2">
                          <EmojiPicker
                            onEmojiClick={selected => { setEmoji(selected); setShowEmojiPicker(false); }}
                            onClose={() => setShowEmojiPicker(false)}
                          />
                        </div>
                      </div>
                    )}
                  </FormGroup>
                </div>
              )}

              {activeTab === 'model' && (
                <div className="space-y-5">
                  {/* 模型选择器 */}
                  <FormGroup label="默认模型">
                    <div className="flex items-center justify-between">
                      <div
                        className="flex-1 px-3 py-2.5 rounded-lg border text-sm mr-2"
                        style={{
                          backgroundColor: 'var(--surface)',
                          borderColor: 'var(--border)',
                          color: modelId ? 'var(--fg)' : 'var(--muted-soft)',
                        }}
                      >
                        {(() => {
                          const m = models.find(x => x.id === modelId);
                          if (!m) return '未选择模型';
                          const p = providers.find(pr => pr.id === m.provider_id);
                          return `${m.display_name || m.name} | ${p?.name || ''}`;
                        })()}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowModelSelect(true)}
                        className="px-3 py-2 rounded-lg text-xs font-medium border transition-colors shrink-0"
                        style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent-dim)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                      >
                        选择模型
                      </button>
                    </div>
                  </FormGroup>

                  {/* Temperature */}
                  <FormGroup label="模型温度">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        {temperatureEnabled ? `当前值: ${temperature.toFixed(1)}` : '未开启（默认 0.7）'}
                      </span>
                      <Toggle checked={temperatureEnabled} onChange={() => setTemperatureEnabled(!temperatureEnabled)} />
                    </div>
                    {temperatureEnabled && (
                      <input
                        type="range" min="0" max="2" step="0.1" value={temperature}
                        onChange={e => setTemperature(parseFloat(e.target.value))}
                        className="w-full h-2 rounded-lg cursor-pointer"
                        style={{ accentColor: 'var(--accent)' }}
                      />
                    )}
                  </FormGroup>

                  {/* Context Rounds */}
                  <FormGroup label="上下文轮数">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        发送给 LLM 的最大对话轮数，0 表示不限制
                      </span>
                      <span
                        className="text-sm font-bold tabular-nums"
                        style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
                      >
                        {contextRounds}
                      </span>
                    </div>
                    <input
                      type="range" min="0" max="100" step="1" value={contextRounds}
                      onChange={e => setContextRounds(parseInt(e.target.value))}
                      className="w-full cursor-pointer"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                  </FormGroup>

                  {/* Deep Thinking */}
                  {(() => {
                    const m = models.find(x => x.id === modelId);
                    if (!isReasoningModel(m)) return null;
                    return (
                      <FormGroup label="深度思考">
                        <select
                          value={thinkingMode}
                          onChange={e => setThinkingMode(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none appearance-none"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--fg)',
                          }}
                          onFocus={e => {
                            (e.target as HTMLElement).style.borderColor = 'var(--accent)';
                            (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)';
                          }}
                          onBlur={e => {
                            (e.target as HTMLElement).style.borderColor = 'var(--border)';
                            (e.target as HTMLElement).style.boxShadow = 'none';
                          }}
                        >
                          <option value="default">默认（按模型行为）</option>
                          <option value="enabled">开启</option>
                          <option value="disabled">关闭</option>
                        </select>
                        <div className="text-xs mt-1.5" style={{ color: 'var(--muted-soft)' }}>
                          {thinkingMode === 'default' ? '由模型自行决定是否输出思考过程' :
                           thinkingMode === 'enabled' ? '强制模型输出深度思考过程' :
                           '禁止模型输出思考过程，直接给出答案'}
                        </div>
                      </FormGroup>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            className="px-6 py-4 border-t flex items-center gap-3 shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            {isEditing && onDelete && (
              <BtnDanger onClick={() => { onDelete(assistant!.id); onClose(); }}>
                删除助手
              </BtnDanger>
            )}
            <div className="flex-1" />
            <BtnSecondary onClick={onClose}>取消</BtnSecondary>
            <button
              type="submit"
              disabled={!name.trim()}
              className="inline-flex items-center justify-center font-medium transition-all duration-150 select-none disabled:opacity-25 disabled:pointer-events-none"
              style={{
                padding: '9px 18px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--accent), #6a82ce)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: '0.01em',
                boxShadow: 'var(--shadow-button)',
              }}
            >
              {isEditing ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={(pid, mid) => { setProviderId(pid); setModelId(mid); }}
        providers={providers.filter(p => p.enabled)}
        models={models}
        currentModelId={modelId}
      />
    </div>
  );
}

// ===== 内联表单组件 =====
function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function FormInput_({ value, onChange, placeholder, autoFocus, required }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; required?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      required={required}
      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--fg)',
      }}
      onFocus={e => {
        (e.target as HTMLElement).style.borderColor = 'var(--accent)';
        (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)';
      }}
      onBlur={e => {
        (e.target as HTMLElement).style.borderColor = 'var(--border)';
        (e.target as HTMLElement).style.boxShadow = 'none';
      }}
    />
  );
}

function FormTextarea_({ value, onChange, rows, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows || 6}
      placeholder={placeholder}
      className="w-full px-3 py-3 rounded-lg border text-sm outline-none resize-none transition-colors leading-relaxed"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--fg)',
        minHeight: 160,
      }}
      onFocus={e => {
        (e.target as HTMLElement).style.borderColor = 'var(--accent)';
        (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)';
      }}
      onBlur={e => {
        (e.target as HTMLElement).style.borderColor = 'var(--border)';
        (e.target as HTMLElement).style.boxShadow = 'none';
      }}
    />
  );
}
