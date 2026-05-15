// 工具设置：记忆提取 LLM + 嵌入模型 + 重排序模型 + 联网搜索 Key
import { useState, useEffect } from 'react';
import type { Provider, Model } from '../../types';
import { toolsApi, settingsApi } from '../../services/api';
import { Toggle, BtnPrimary, BtnSecondary } from '../shared/Primitives';
import { Eye, EyeOff } from 'lucide-react';

interface ToolsSettingsProps {
  providers: Provider[];
  models: Model[];
}

export default function ToolsSettings({ providers, models }: ToolsSettingsProps) {
  // 记忆 LLM
  const [memLlmProviderId, setMemLlmProviderId] = useState('');
  const [memLlmModelId, setMemLlmModelId] = useState('');

  // 嵌入模型
  const [embApiUrl, setEmbApiUrl] = useState('');
  const [embApiKey, setEmbApiKey] = useState('');
  const [embApiKeyMasked, setEmbApiKeyMasked] = useState('');
  const [embModelName, setEmbModelName] = useState('');
  const [embSaved, setEmbSaved] = useState(false);
  const [showEmbKey, setShowEmbKey] = useState(false);

  // 重排序模型
  const [rerankApiUrl, setRerankApiUrl] = useState('');
  const [rerankApiKey, setRerankApiKey] = useState('');
  const [rerankApiKeyMasked, setRerankApiKeyMasked] = useState('');
  const [rerankModelName, setRerankModelName] = useState('');
  const [rerankSaved, setRerankSaved] = useState(false);
  const [showRerankKey, setShowRerankKey] = useState(false);

  // IQS Key
  const [iqsConfigured, setIqsConfigured] = useState(false);
  const [iqsKeyMasked, setIqsKeyMasked] = useState('');
  const [iqsKeyInput, setIqsKeyInput] = useState('');
  const [iqsSaving, setIqsSaving] = useState(false);

  const enabledProviders = providers.filter(p => p.enabled);
  const memLlmModels = models.filter(m => m.provider_id === memLlmProviderId);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const [emb, rerank, iqs] = await Promise.all([
        toolsApi.getEmbeddingConfig(),
        toolsApi.getRerankerConfig(),
        settingsApi.getIqsKey(),
      ]);
      setEmbApiUrl(emb.apiUrl || '');
      setEmbApiKey(emb.apiKey || '');
      setEmbApiKeyMasked(emb.apiKeyMasked || '');
      setEmbModelName(emb.modelName || '');
      setRerankApiUrl(rerank.apiUrl || '');
      setRerankApiKey(rerank.apiKey || '');
      setRerankApiKeyMasked(rerank.apiKeyMasked || '');
      setRerankModelName(rerank.modelName || '');
      setIqsConfigured(iqs.configured);
      setIqsKeyMasked(iqs.masked || '');
    } catch (e) { console.error('加载工具配置失败:', e); }
  };

  const handleSaveEmbedding = async () => {
    try {
      await toolsApi.updateEmbeddingConfig({ apiUrl: embApiUrl, apiKey: embApiKey, modelName: embModelName });
      await loadConfigs();
      setEmbSaved(true);
      setTimeout(() => setEmbSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  const handleSaveReranker = async () => {
    try {
      await toolsApi.updateRerankerConfig({ apiUrl: rerankApiUrl, apiKey: rerankApiKey, modelName: rerankModelName });
      await loadConfigs();
      setRerankSaved(true);
      setTimeout(() => setRerankSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  const handleSaveIqsKey = async () => {
    if (!iqsKeyInput.trim()) return;
    setIqsSaving(true);
    try {
      await settingsApi.updateIqsKey(iqsKeyInput.trim());
      await loadConfigs();
      setIqsKeyInput('');
    } catch (e: any) {
      alert(e.message || '保存失败');
    } finally {
      setIqsSaving(false);
    }
  };

  const handleRemoveIqsKey = async () => {
    setIqsSaving(true);
    try {
      await settingsApi.updateIqsKey('');
      await loadConfigs();
    } catch (e: any) {
      alert(e.message || '移除失败');
    } finally {
      setIqsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-6 space-y-10">
      <PageTitle icon="🔧" title="工具设置" desc="配置记忆提取、向量检索与联网搜索所需的模型与密钥" />

      {/* 记忆提取 LLM */}
      <Section title="记忆提取 LLM 模型">
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          选择用于从对话中提取长期记忆的大语言模型
        </p>
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="提供商"
            value={memLlmProviderId}
            onChange={e => { setMemLlmProviderId(e.target.value); setMemLlmModelId(''); }}
            options={enabledProviders.map(p => ({ value: p.id, label: p.name }))}
            placeholder="选择提供商"
          />
          <SelectField
            label="模型"
            value={memLlmModelId}
            onChange={e => setMemLlmModelId(e.target.value)}
            options={memLlmModels.map(m => ({ value: m.id, label: m.display_name || m.name }))}
            placeholder="选择模型"
          />
        </div>
      </Section>

      {/* 嵌入模型 */}
      <Section title="嵌入模型配置">
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          用于向量化记忆和对话内容的嵌入模型
        </p>
        <div className="space-y-4">
          <InputRow label="API 地址" value={embApiUrl} onChange={setEmbApiUrl} placeholder="https://api.openai.com/v1" />
          <InputRow label="API Key" type={showEmbKey ? 'text' : 'password'} value={embApiKey} onChange={setEmbApiKey} placeholder="sk-...">
            <button type="button" onClick={() => setShowEmbKey(!showEmbKey)} className="absolute right-3 top-2.5" style={{ color: 'var(--muted)' }}>
              {showEmbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </InputRow>
          <InputRow label="模型名称" value={embModelName} onChange={setEmbModelName} placeholder="text-embedding-3-small" />
          <div className="flex items-center gap-3">
            <BtnPrimary onClick={handleSaveEmbedding}>保存嵌入配置</BtnPrimary>
            {embSaved && <span className="text-xs" style={{ color: 'var(--success)' }}>已保存</span>}
          </div>
        </div>
      </Section>

      {/* 重排序模型 */}
      <Section title="重排序模型配置">
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          用于对检索结果进行语义重排序的模型
        </p>
        <div className="space-y-4">
          <InputRow label="API 地址" value={rerankApiUrl} onChange={setRerankApiUrl} placeholder="https://api.openai.com/v1" />
          <InputRow label="API Key" type={showRerankKey ? 'text' : 'password'} value={rerankApiKey} onChange={setRerankApiKey} placeholder="sk-...">
            <button type="button" onClick={() => setShowRerankKey(!showRerankKey)} className="absolute right-3 top-2.5" style={{ color: 'var(--muted)' }}>
              {showRerankKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </InputRow>
          <InputRow label="模型名称" value={rerankModelName} onChange={setRerankModelName} placeholder="bge-reranker-v2-m3" />
          <div className="flex items-center gap-3">
            <BtnPrimary onClick={handleSaveReranker}>保存重排序配置</BtnPrimary>
            {rerankSaved && <span className="text-xs" style={{ color: 'var(--success)' }}>已保存</span>}
          </div>
        </div>
      </Section>

      {/* 联网搜索 Key */}
      <Section title="联网搜索 Key">
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          阿里云 IQS API Key，用于联网搜索功能
        </p>
        {iqsConfigured ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <code className="flex-1 text-xs font-mono truncate" style={{ color: 'var(--muted)' }}>{iqsKeyMasked}</code>
            <BtnSecondary onClick={handleRemoveIqsKey}>移除</BtnSecondary>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="password"
                value={iqsKeyInput}
                onChange={e => setIqsKeyInput(e.target.value)}
                placeholder="输入 IQS API Key..."
                className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
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
            </div>
            <BtnPrimary onClick={handleSaveIqsKey} disabled={iqsSaving || !iqsKeyInput.trim()}>
              {iqsSaving ? '保存中...' : '保存'}
            </BtnPrimary>
          </div>
        )}
      </Section>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <h3 className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--fg)', letterSpacing: '0.06em' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function SelectField({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: { value: string; label: string }[]; placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</label>
      <select value={value} onChange={onChange}
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
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function InputRow({ label, value, onChange, placeholder, type, children }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; children?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</label>
      <div className="relative">
        <input
          type={type || 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-3 pr-10 py-2.5 rounded-lg border text-sm outline-none"
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
        {children}
      </div>
    </div>
  );
}
