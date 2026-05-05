import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import type { Assistant, Provider, Model, KnowledgeBase } from '../types';
import { cn } from '../lib/utils';
import { isReasoningModel } from '../lib/reasoning';
import { knowledgeApi } from '../services/api';
import EmojiIcon from './shared/EmojiIcon';
import EmojiPicker from './shared/EmojiPicker';
import ModelSelectModal from './shared/ModelSelectModal';

interface AssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Assistant>) => void;
  assistant?: Assistant | null;
  providers: Provider[];
  models: Model[];
}

// 新建助手默认 emoji 轮换列表（全部使用有效 emoji，无空字符串）
const DEFAULT_EMOJIS = ['🤖', '🐱', '⚡', '✨', '🔥', '🌟', '🚀', '💡', '🎯', '🌈'];

// 获取下一个默认 emoji（基于当前时间戳轮换）
function getNextDefaultEmoji(): string {
  const index = Math.floor(Date.now() / 1000) % DEFAULT_EMOJIS.length;
  return DEFAULT_EMOJIS[index];
}

export default function AssistantModal({ isOpen, onClose, onSave, assistant, providers, models }: AssistantModalProps) {
  const [activeTab, setActiveTab] = useState<'prompt' | 'model' | 'knowledge'>('prompt');
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [emoji, setEmoji] = useState('🤖');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [temperatureEnabled, setTemperatureEnabled] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [contextRounds, setContextRounds] = useState(10);
  const [enableMemory, setEnableMemory] = useState(false);
  const [thinkingMode, setThinkingMode] = useState('default');
  const [showModelSelect, setShowModelSelect] = useState(false);
  // 知识库关联
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [kbLoaded, setKbLoaded] = useState(false);

  // 加载知识库列表（切换到知识库 tab 时）
  const loadKnowledgeBases = async () => {
    if (kbLoaded) return;
    try {
      const kbs = await knowledgeApi.list();
      setKnowledgeBases(kbs as KnowledgeBase[]);
      setKbLoaded(true);
    } catch (err) {
      console.error('加载知识库列表失败:', err);
    }
  };

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
        setEnableMemory(!!assistant.enable_memory);
        setThinkingMode(assistant.thinking_mode || 'default');
        // 解析已关联的知识库 ID
        try {
          const ids = JSON.parse(assistant.knowledge_base_ids || '[]');
          setSelectedKbIds(Array.isArray(ids) ? ids : []);
        } catch { setSelectedKbIds([]); }
      } else {
        setName('');
        setSystemPrompt('');
        setEmoji(getNextDefaultEmoji());
        // 默认选择第一个启用的供应商，并自动选择其第一个模型
        const firstProvider = providers[0];
        setProviderId(firstProvider?.id || '');
        const firstProviderModels = models.filter(m => m.provider_id === firstProvider?.id);
        setModelId(firstProviderModels[0]?.id || '');
        setTemperatureEnabled(false);
        setTemperature(0.7);
        setContextRounds(10);
        setEnableMemory(false);
        setThinkingMode('default');
        setSelectedKbIds([]);
      }
      setActiveTab('prompt');
      setShowEmojiPicker(false);
      setKbLoaded(false);
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
      enable_memory: enableMemory ? 1 : 0,
      thinking_mode: thinkingMode,
      knowledge_base_ids: JSON.stringify(selectedKbIds),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl w-full max-w-[720px] h-[70vh] min-h-[500px] flex flex-col shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-background)' }}>
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="px-5 py-3.5 flex justify-between items-center border-b shrink-0"
            style={{ borderColor: 'var(--color-border)' }}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <EmojiIcon emoji={emoji} size={24} fontSize={13} />
              {name || (assistant ? '编辑助手' : '新建助手')}
            </h3>
            <button type="button" onClick={onClose} className="text-2xl leading-none hover:opacity-70" style={{ color: 'var(--color-text-3)' }}>
              &times;
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar Tabs */}
            <div className="w-40 flex flex-col p-2 shrink-0 border-r" style={{ borderColor: 'var(--color-border)' }}>
              {[
                { key: 'prompt' as const, label: '提示词设置' },
                { key: 'model' as const, label: '模型设置' },
                { key: 'knowledge' as const, label: '知识库' },
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  className={cn("text-left px-4 py-2.5 rounded-xl text-sm font-medium mb-0.5 transition-colors")}
                  style={{
                    backgroundColor: activeTab === tab.key ? 'var(--color-background-mute)' : 'transparent',
                    color: activeTab === tab.key ? 'var(--color-text)' : 'var(--color-text-2)',
                  }}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: 'var(--color-background-soft)' }}>
              {activeTab === 'prompt' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>名称</label>
                    <input
                      autoFocus
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border focus:outline-none focus:ring-2 text-sm"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)',
                        '--tw-ring-color': 'var(--color-primary)',
                      } as React.CSSProperties}
                      placeholder="助手名称"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>提示词</label>
                    <textarea
                      value={systemPrompt}
                      onChange={e => setSystemPrompt(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 resize-none min-h-[260px] text-sm leading-relaxed"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)',
                        '--tw-ring-color': 'var(--color-primary)',
                      } as React.CSSProperties}
                      placeholder="设定助手的角色、能力和行为规范..."
                    />
                  </div>
                  <div className="relative">
                    <label className="block text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>Emoji 图标</label>
                    {/* 快速选择栏 */}
                    <div className="flex items-center gap-1.5 mb-2">
                      {DEFAULT_EMOJIS.map((e, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setEmoji(e)}
                          className={cn(
                            "w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all",
                            emoji === e ? "ring-2 ring-offset-1 scale-110" : "hover:bg-black/5"
                          )}
                          style={{
                            backgroundColor: emoji === e ? 'var(--color-primary-mute)' : 'var(--color-background)',
                          }}
                        >
                          {e}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-medium transition-colors hover:bg-black/5"
                        style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text-2)' }}
                        title="更多 Emoji"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Emoji Picker 悬浮框 */}
                    {showEmojiPicker && (
                      <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 60 }}>
                        <EmojiPicker
                          onEmojiClick={(selected) => {
                            setEmoji(selected);
                            setShowEmojiPicker(false);
                          }}
                          onClose={() => setShowEmojiPicker(false)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'model' && (
                <div className="space-y-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>默认模型</label>
                      <button
                        type="button"
                        onClick={() => setShowModelSelect(true)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:bg-black/5"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                      >
                        选择模型
                      </button>
                    </div>
                    <div className="px-4 py-2.5 rounded-xl border text-sm"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        borderColor: 'var(--color-border)',
                        color: modelId ? 'var(--color-text)' : 'var(--color-text-3)',
                      }}>
                      {(() => {
                        const selectedModel = models.find(m => m.id === modelId);
                        if (!selectedModel) return '未选择模型';
                        const p = providers.find(pr => pr.id === selectedModel.provider_id);
                        return `${selectedModel.display_name || selectedModel.name} | ${p?.name || ''}`;
                      })()}
                    </div>
                  </div>

                  {/* Temperature Toggle */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>模型温度</label>
                      <button
                        type="button"
                        className={cn("w-11 h-6 rounded-full transition-colors relative")}
                        style={{ backgroundColor: temperatureEnabled ? 'var(--color-primary)' : 'var(--color-border)' }}
                        onClick={() => setTemperatureEnabled(!temperatureEnabled)}
                      >
                        <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                          temperatureEnabled ? "left-[22px]" : "left-1")} />
                      </button>
                    </div>
                    {temperatureEnabled && (
                      <input
                        type="range" min="0" max="2" step="0.1" value={temperature}
                        onChange={e => setTemperature(parseFloat(e.target.value))}
                        className="w-full h-2 rounded-lg cursor-pointer"
                      />
                    )}
                    <div className="text-xs mt-1" style={{ color: 'var(--color-text-3)' }}>
                      {temperatureEnabled ? `当前值: ${temperature.toFixed(1)}` : '未开启 (默认 0.7)'}
                    </div>
                  </div>

                  {/* Context Rounds */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>上下文轮数</label>
                      <span className="text-sm font-bold" style={{ color: 'var(--color-primary)' }}>{contextRounds}</span>
                    </div>
                    <input
                      type="range" min="0" max="100" step="1" value={contextRounds}
                      onChange={e => setContextRounds(parseInt(e.target.value))}
                      className="w-full cursor-pointer"
                    />
                  </div>

                  {/* Deep Thinking Mode — 仅在选定模型支持推理时显示 */}
                  {(() => {
                    const selectedModel = models.find(m => m.id === modelId);
                    return isReasoningModel(selectedModel) ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>深度思考</label>
                        </div>
                        <select
                          value={thinkingMode}
                          onChange={e => setThinkingMode(e.target.value)}
                          className="w-full px-4 py-2.5 rounded-xl border focus:outline-none text-sm appearance-none"
                          style={{
                            backgroundColor: 'var(--color-background)',
                            borderColor: 'var(--color-border)',
                            color: 'var(--color-text)',
                          }}
                        >
                          <option value="default">默认（按模型行为）</option>
                          <option value="enabled">开启</option>
                          <option value="disabled">关闭</option>
                        </select>
                        <div className="text-xs mt-1" style={{ color: 'var(--color-text-3)' }}>
                          {thinkingMode === 'default' ? '由模型自行决定是否输出思考过程' :
                           thinkingMode === 'enabled' ? '强制模型输出深度思考过程' :
                           '禁止模型输出思考过程，直接给出答案'}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Memory Toggle */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>启用记忆</label>
                    <button
                      type="button"
                      className={cn("w-11 h-6 rounded-full transition-colors relative")}
                      style={{ backgroundColor: enableMemory ? 'var(--color-primary)' : 'var(--color-border)' }}
                      onClick={() => setEnableMemory(!enableMemory)}
                    >
                      <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                        enableMemory ? "left-[22px]" : "left-1")} />
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'knowledge' && (
                <div className="space-y-5">
                  {(() => { loadKnowledgeBases(); return null; })()}
                  <div>
                    <label className="block text-sm font-bold mb-3" style={{ color: 'var(--color-text)' }}>
                      关联知识库
                    </label>
                    <div className="text-xs mb-3" style={{ color: 'var(--color-text-3)' }}>
                      选中的知识库将在对话时自动检索相关内容，注入到系统提示词中
                    </div>
                    {knowledgeBases.length === 0 ? (
                      <div className="text-sm py-6 text-center rounded-xl border"
                        style={{ color: 'var(--color-text-3)', borderColor: 'var(--color-border)', borderStyle: 'dashed' }}>
                        暂无知识库，请先在设置中创建知识库
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {knowledgeBases.map(kb => {
                          const isSelected = selectedKbIds.includes(kb.id);
                          return (
                            <label
                              key={kb.id}
                              className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors",
                                isSelected ? "" : "hover:bg-black/5"
                              )}
                              style={{
                                borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                                backgroundColor: isSelected ? 'var(--color-primary-mute)' : 'var(--color-background)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedKbIds(prev =>
                                    prev.includes(kb.id)
                                      ? prev.filter(id => id !== kb.id)
                                      : [...prev, kb.id]
                                  );
                                }}
                                className="w-4 h-4 rounded accent-current"
                                style={{ color: 'var(--color-primary)' }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                                  {kb.name}
                                </div>
                                <div className="text-xs truncate" style={{ color: 'var(--color-text-3)' }}>
                                  {kb.embedding_model_id ? '已配置嵌入模型' : '使用全局嵌入模型'}
                                  {' · '}分块 {kb.chunk_size} · TopK {kb.search_top_k}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {selectedKbIds.length > 0 && (
                      <div className="text-xs mt-2" style={{ color: 'var(--color-primary)' }}>
                        已选择 {selectedKbIds.length} 个知识库
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 border-t flex justify-end gap-3 shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <button type="button" onClick={onClose}
              className="px-5 py-2 rounded-lg text-sm font-medium border transition-colors"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>
              取消
            </button>
            <button type="submit"
              className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              保存
            </button>
          </div>
        </form>
      </div>

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={(providerId, modelId) => {
          setProviderId(providerId);
          setModelId(modelId);
        }}
        providers={providers.filter(p => p.enabled)}
        models={models}
        currentModelId={modelId}
      />
    </div>
  );
}
