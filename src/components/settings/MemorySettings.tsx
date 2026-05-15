// 记忆设置：开关 + 统计 + 个人简介 Textarea + 记忆模型设置弹窗
import { useState, useEffect } from 'react';
import type { Provider, Model, MemorySettings as MemorySettingsType } from '../../types';
import { memoryApi, profileApi } from '../../services/api';
import { Toggle, BtnPrimary, BtnSecondary } from '../shared/Primitives';
import { Settings, Loader2 } from 'lucide-react';

interface MemorySettingsProps {
  providers: Provider[];
  models: Model[];
}

export default function MemorySettings({ providers, models }: MemorySettingsProps) {
  const [settings, setSettings] = useState<MemorySettingsType | null>(null);
  const [memStats, setMemStats] = useState<{ total: number; active: number; important: number }>({ total: 0, active: 0, important: 0 });
  const [profileText, setProfileText] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [s, mems, profile] = await Promise.all([
        memoryApi.getSettings(),
        memoryApi.list(),
        profileApi.list(),
      ]);
      setSettings(s);
      setMemStats({
        total: mems.length,
        active: mems.filter((m: any) => m.status === 'active').length,
        important: mems.filter((m: any) => (m.importance || 0) >= 0.5).length,
      });
      // 将 KV entries 合并为一个文本块
      if (profile && profile.length > 0) {
        setProfileText(profile.map((e: any) => `${e.key}: ${e.value}`).join('\n'));
      }
    } catch (e) { console.error('加载记忆数据失败:', e); }
  };

  const handleToggle = async () => {
    if (!settings) return;
    const newEnabled = settings.enabled === 1 ? 0 : 1;
    try {
      const s = await memoryApi.updateSettings({ enabled: newEnabled });
      setSettings(s);
    } catch (e) { console.error(e); }
  };

  const handleSaveProfile = async () => {
    try {
      // 解析文本块为 KV 条目并全量更新
      const kv: Record<string, string> = {};
      const lines = profileText.split('\n').filter(Boolean);
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      await profileApi.update(kv);
      await loadData();
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-6 space-y-10">
      <PageTitle icon="🧠" title="长期记忆" desc="管理全局记忆开关与您的个人背景信息" />

      {/* 记忆开关 + 统计 */}
      <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--fg)', letterSpacing: '0.06em' }}>全局记忆</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {settings?.enabled ? '已开启 — 系统会自动从对话中提取记忆' : '已关闭 — 不会自动提取新记忆'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={settings?.enabled === 1} onChange={handleToggle} />
            <button
              onClick={() => setShowModal(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors border"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)';
                (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = 'var(--muted)';
              }}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 gap-2.5 mt-2">
          <StatCard label="活跃记忆" value={memStats.active} />
          <StatCard label="记忆总数" value={memStats.total} accent="var(--fg)" />
        </div>
      </div>

      {/* 个人简介 Textarea */}
      <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--fg)', letterSpacing: '0.06em' }}>个人简介</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            每行一个条目，格式为 "键: 值"。AI 在对话时会参考这些信息
          </p>
        </div>
        <textarea
          value={profileText}
          onChange={e => setProfileText(e.target.value)}
          rows={8}
          placeholder={"昵称: 小明\n位置: 北京\n职业: 软件工程师\n技术栈: React, TypeScript, Python\n爱好: 骑行, 摄影"}
          className="w-full px-4 py-3 rounded-lg border text-sm outline-none resize-y leading-relaxed"
          style={{
            backgroundColor: 'var(--chat-bg)',
            borderColor: 'var(--border)',
            color: 'var(--fg)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
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
        <div className="flex items-center gap-3">
          <BtnPrimary onClick={handleSaveProfile}>保存个人简介</BtnPrimary>
          {profileSaved && <span className="text-xs" style={{ color: 'var(--success)' }}>已保存</span>}
        </div>
      </div>

      {/* 记忆模型设置弹窗 */}
      {showModal && settings && (
        <MemorySettingsModal
          settings={settings}
          providers={providers}
          models={models}
          onClose={() => setShowModal(false)}
          onSave={async (updates) => {
            const s = await memoryApi.updateSettings(updates);
            setSettings(s);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}

// ===== 内联组件 =====

function PageTitle({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
        <span>{icon}</span>
        {title}
      </h2>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{desc}</p>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border px-4 py-4 text-center" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--chat-bg)' }}>
      <div className="font-bold tabular-nums" style={{ color: accent || 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--muted-soft)', fontSize: 11, letterSpacing: '0.03em', fontWeight: 500 }}>{label}</div>
    </div>
  );
}

// ===== 记忆模型设置弹窗 =====
function MemorySettingsModal({ settings, providers, models, onClose, onSave }: {
  settings: MemorySettingsType;
  providers: Provider[];
  models: Model[];
  onClose: () => void;
  onSave: (updates: Partial<MemorySettingsType>) => void;
}) {
  const [llmProviderId, setLlmProviderId] = useState(settings.llm_provider_id || '');
  const [llmModelId, setLlmModelId] = useState(settings.llm_model_id || '');
  const [embProviderId, setEmbProviderId] = useState(settings.embedding_provider_id || '');
  const [embModelId, setEmbModelId] = useState(settings.embedding_model_id || '');
  const [embDim, setEmbDim] = useState(settings.embedding_dimension || 1536);

  const enabledProviders = providers.filter(p => p.enabled);
  const llmModels = models.filter(m => m.provider_id === llmProviderId);
  const embModels = models.filter(m => m.provider_id === embProviderId);

  // 阻止背景点击关闭
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ backgroundColor: 'rgba(50,58,85,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="rounded-[18px] w-full max-w-[480px] flex flex-col" style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)' }}>
        <div className="flex justify-between items-center border-b" style={{ padding: '18px 22px', borderColor: 'var(--border)' }}>
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>记忆模型设置</h3>
          <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-lg transition-colors border" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto" style={{ padding: 22 }}>
          {/* LLM 模型选择 */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>LLM 模型（记忆提取）</label>
            <select value={llmProviderId} onChange={e => { setLlmProviderId(e.target.value); setLlmModelId(''); }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none mb-2"
              style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)' }}>
              <option value="">选择提供商</option>
              {enabledProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={llmModelId} onChange={e => setLlmModelId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)' }}>
              <option value="">选择模型</option>
              {llmModels.map(m => <option key={m.id} value={m.id}>{m.display_name || m.name}</option>)}
            </select>
          </div>

          {/* 嵌入模型选择 */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>嵌入模型</label>
            <select value={embProviderId} onChange={e => { setEmbProviderId(e.target.value); setEmbModelId(''); }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none mb-2"
              style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)' }}>
              <option value="">选择提供商</option>
              {enabledProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={embModelId} onChange={e => setEmbModelId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)' }}>
              <option value="">选择模型</option>
              {embModels.map(m => <option key={m.id} value={m.id}>{m.display_name || m.name}</option>)}
            </select>
          </div>

          {/* 嵌入维度 */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>嵌入维度</label>
            <input type="number" value={embDim} onChange={e => setEmbDim(parseInt(e.target.value) || 1536)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)' }} />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t" style={{ padding: '14px 22px', borderColor: 'var(--border)' }}>
          <BtnSecondary onClick={onClose}>取消</BtnSecondary>
          <BtnPrimary onClick={() => onSave({
            llm_provider_id: llmProviderId || null,
            llm_model_id: llmModelId || null,
            embedding_provider_id: embProviderId || null,
            embedding_model_id: embModelId || null,
            embedding_dimension: embDim,
          })}>保存</BtnPrimary>
        </div>
      </div>
    </div>
  );
}
