// 工具设置：记忆提取 LLM + 嵌入模型 + 重排序模型 + 联网搜索 Key
import { useState, useEffect, useRef } from 'react';
import type { Provider, Model } from '../../types';
import { toolsApi, memoryApi, settingsApi } from '../../services/api';
import { Toggle, BtnPrimary } from '../shared/Primitives';
import { ChevronDown, Eye, EyeOff, Search, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface ToolsSettingsProps {
  providers: Provider[];
  models: Model[];
}

export default function ToolsSettings({ providers, models }: ToolsSettingsProps) {
  // 记忆提取 LLM
  const [memLlmModelId, setMemLlmModelId] = useState('');
  const [memLlmSaved, setMemLlmSaved] = useState(false);

  // 嵌入模型
  const [embModelName, setEmbModelName] = useState('');
  const [embSaved, setEmbSaved] = useState(false);

  // 重排序模型
  const [rerankModelName, setRerankModelName] = useState('');
  const [rerankSaved, setRerankSaved] = useState(false);

  // IQS Key
  const [iqsKeyInput, setIqsKeyInput] = useState('');
  const [iqsConfigured, setIqsConfigured] = useState(false);
  const [iqsKeyMasked, setIqsKeyMasked] = useState('');
  const [showIqsKey, setShowIqsKey] = useState(false);
  const [iqsTesting, setIqsTesting] = useState(false);
  const [iqsTestResult, setIqsTestResult] = useState<{ success: boolean; time: number; error?: string } | null>(null);

  const enabledModels = models.filter(m => {
    const p = providers.find(p => p.id === m.provider_id);
    return p?.enabled;
  });

  useEffect(() => { loadConfigs(); }, []);

  const loadConfigs = async () => {
    try {
      const [mem, emb, rerank, iqs] = await Promise.all([
        memoryApi.getSettings(),
        toolsApi.getEmbeddingConfig(),
        toolsApi.getRerankerConfig(),
        settingsApi.getIqsKey(),
      ]);
      if (mem?.llm_model_id) setMemLlmModelId(mem.llm_model_id);
      if (emb?.modelName) setEmbModelName(emb.modelName);
      if (rerank?.modelName) setRerankModelName(rerank.modelName);
      setIqsConfigured(iqs.configured);
      setIqsKeyMasked(iqs.masked || '');
    } catch (e) { console.error('加载工具配置失败:', e); }
  };

  // 记忆 LLM 模型选择 → 自动保存
  const handleMemLlmChange = async (modelId: string) => {
    setMemLlmModelId(modelId);
    const model = models.find(m => m.id === modelId);
    if (!model) return;
    try {
      await memoryApi.updateSettings({ llm_provider_id: model.provider_id, llm_model_id: model.id });
      setMemLlmSaved(true);
      setTimeout(() => setMemLlmSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  // 嵌入模型选择 → 自动保存
  const handleEmbModelChange = async (modelName: string) => {
    setEmbModelName(modelName);
    try {
      await toolsApi.updateEmbeddingConfig({ apiUrl: '', apiKey: '', modelName });
      setEmbSaved(true);
      setTimeout(() => setEmbSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  // 重排序模型选择 → 自动保存
  const handleRerankModelChange = async (modelName: string) => {
    setRerankModelName(modelName);
    try {
      await toolsApi.updateRerankerConfig({ apiUrl: '', apiKey: '', modelName });
      setRerankSaved(true);
      setTimeout(() => setRerankSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  // IQS Key 即时保存
  const saveIqsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleIqsKeyChange = (val: string) => {
    setIqsKeyInput(val);
    if (saveIqsTimer.current) clearTimeout(saveIqsTimer.current);
    saveIqsTimer.current = setTimeout(async () => {
      if (!val.trim()) return;
      try {
        await settingsApi.updateIqsKey(val.trim());
        await loadConfigs();
        setIqsKeyInput('');
        setIqsTestResult(null);
      } catch (e: any) { /* ignore */ }
    }, 600);
  };

  // IQS Key 测试
  const handleTestIqsKey = async () => {
    const keyToTest = iqsKeyInput.trim() || iqsKeyMasked;
    if (!keyToTest) return;
    setIqsTesting(true);
    setIqsTestResult(null);
    try {
      const result = await settingsApi.testIqsKey(keyToTest);
      setIqsTestResult(result);
    } catch (e) {
      setIqsTestResult({ success: false, time: 0, error: e instanceof Error ? e.message : '测试失败' });
    } finally {
      setIqsTesting(false);
    }
  };

  // 匹配当前选中的模型对象
  const memLlmModel = models.find(m => m.id === memLlmModelId);
  const embModel = models.find(m => m.name === embModelName);
  const rerankModel = models.find(m => m.name === rerankModelName);

  return (
    <div className="w-full py-8 px-6 space-y-10">
      <PageTitle title="工具设置" desc="配置记忆提取、向量检索与联网搜索所需的模型与密钥" />

      {/* 记忆提取 LLM 模型 */}
      <SettingBlock label="记忆提取 LLM 模型" desc="选择用于从对话中提取长期记忆的大语言模型" saved={memLlmSaved}>
        <ModelSelect
          models={enabledModels}
          providers={providers}
          selectedModelId={memLlmModelId}
          selectedModelName={memLlmModel?.display_name || memLlmModel?.name}
          onChange={handleMemLlmChange}
          placeholder="选择模型"
          selectBy="id"
        />
      </SettingBlock>

      {/* 嵌入模型 */}
      <SettingBlock label="嵌入模型配置" desc="用于向量化记忆和对话内容的嵌入模型" saved={embSaved}>
        <ModelSelect
          models={enabledModels}
          providers={providers}
          selectedModelId={embModel?.id || ''}
          selectedModelName={embModel?.display_name || embModel?.name}
          onChange={(modelId) => {
            const m = models.find(x => x.id === modelId);
            if (m) handleEmbModelChange(m.name);
          }}
          placeholder="选择模型"
          selectBy="id"
        />
      </SettingBlock>

      {/* 重排序模型 */}
      <SettingBlock label="重排序模型配置" desc="用于对检索结果进行语义重排序的模型" saved={rerankSaved}>
        <ModelSelect
          models={enabledModels}
          providers={providers}
          selectedModelId={rerankModel?.id || ''}
          selectedModelName={rerankModel?.display_name || rerankModel?.name}
          onChange={(modelId) => {
            const m = models.find(x => x.id === modelId);
            if (m) handleRerankModelChange(m.name);
          }}
          placeholder="选择模型"
          selectBy="id"
        />
      </SettingBlock>

      {/* 联网搜索 Key */}
      <SettingBlock label="联网搜索 Key" desc="阿里云 IQS API Key，用于联网搜索功能">
        {iqsConfigured && !iqsKeyInput && (
          <p style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-body)', marginBottom: 8 }}>已配置 ({iqsKeyMasked})</p>
        )}
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="relative flex-1">
            <input
              type={showIqsKey ? 'text' : 'password'}
              value={iqsKeyInput}
              onChange={e => handleIqsKeyChange(e.target.value)}
              placeholder="sk-..."
              className="w-full px-4 py-2.5 border-none outline-none bg-transparent"
              style={{ fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--fg)' }}
            />
            <button type="button" onClick={() => setShowIqsKey(!showIqsKey)} className="absolute right-3 top-2.5" style={{ color: 'var(--muted)' }}>
              {showIqsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button type="button" onClick={handleTestIqsKey} disabled={iqsTesting}
            className="px-4 border-l font-medium transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
            {iqsTesting ? '测试中...' : '测试'}
          </button>
        </div>
        {iqsTestResult && (
          <div className="flex items-center gap-2 mt-2" style={{ fontSize: 12, fontFamily: 'var(--font-body)' }}>
            {iqsTestResult.success ? (
              <>
                <CheckCircle className="w-4 h-4" style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--success)' }}>连接成功 ({iqsTestResult.time}ms)</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                <span style={{ color: 'var(--danger)' }}>{iqsTestResult.error || '连接失败'}</span>
              </>
            )}
          </div>
        )}
      </SettingBlock>
    </div>
  );
}

// ===== 内联组件 =====

function PageTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      <p className="mt-1" style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>{desc}</p>
    </div>
  );
}

function SettingBlock({ label, desc, saved, children }: { label: string; desc: string; saved?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div className="setting-group-label">{label}</div>
      <p style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)', marginBottom: 8 }}>{desc}</p>
      {children}
      {saved && (
        <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-body)', marginLeft: 8 }}>已保存</span>
      )}
    </div>
  );
}

// ===== 模型选择器（参考侧边栏助手选择器样式） =====
function ModelSelect({
  models, providers, selectedModelId, selectedModelName, onChange, placeholder, selectBy,
}: {
  models: Model[];
  providers: Provider[];
  selectedModelId: string;
  selectedModelName?: string;
  onChange: (modelId: string) => void;
  placeholder: string;
  selectBy: 'id' | 'name';
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const filtered = search.trim()
    ? models.filter(m => (m.display_name || m.name).toLowerCase().includes(search.toLowerCase()))
    : models;

  // 按提供商分组
  const grouped: Record<string, Model[]> = {};
  for (const m of filtered) {
    const p = providers.find(p => p.id === m.provider_id);
    const group = p?.name || '未知';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(m);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
          color: selectedModelName ? 'var(--fg)' : 'var(--muted)',
          boxShadow: '0 1px 2px rgba(70, 85, 120, 0.04)',
          fontSize: 13,
          fontFamily: 'var(--font-body)',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(85, 112, 184, 0.1)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(70, 85, 120, 0.04)';
        }}
      >
        <span className="flex-1 truncate">{selectedModelName || placeholder}</span>
        <ChevronDown
          className="w-[10px] h-[10px] shrink-0 transition-transform duration-200"
          style={{ color: 'var(--muted)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-xl border py-1 z-50"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-dropdown)',
            maxHeight: 280,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
              <input
                placeholder="搜索模型..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                className="w-full pl-8 pr-2 py-1.5 rounded-lg border text-xs outline-none bg-transparent"
                style={{ borderColor: 'var(--border)', color: 'var(--fg)', fontSize: 12, fontFamily: 'var(--font-body)' }}
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {Object.entries(grouped).map(([providerName, providerModels]) => (
              <div key={providerName}>
                <div className="px-3 py-1.5" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--muted-soft)', textTransform: 'uppercase' }}>
                  {providerName}
                </div>
                {providerModels.map(m => {
                  const isSelected = selectBy === 'id' ? m.id === selectedModelId : m.name === selectedModelId;
                  return (
                    <button
                      key={m.id}
                      onClick={() => { onChange(m.id); setOpen(false); setSearch(''); }}
                      className="w-full text-left flex items-center gap-3 px-3 py-2 transition-colors"
                      style={{
                        backgroundColor: isSelected ? 'var(--accent-dim)' : 'transparent',
                        color: isSelected ? 'var(--accent)' : 'var(--fg)',
                        fontSize: 13,
                        fontWeight: isSelected ? 600 : 400,
                        fontFamily: 'var(--font-body)',
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)';
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                      }}
                    >
                      <span className="truncate">{m.display_name || m.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center" style={{ fontSize: 12, color: 'var(--muted-soft)' }}>无匹配模型</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
