// 模型设置：供应商管理 + 模型管理
import { useState, useEffect, useRef } from 'react';
import type { Provider, Model } from '../../types';
import { providersApi, modelsApi } from '../../services/api';
import { Toggle, BtnPrimary, BtnSecondary, BtnDanger } from '../shared/Primitives';
import { cn } from '../../lib/utils';
import { Search, Plus, Eye, EyeOff, Minus, Box, RefreshCw, Activity, Loader2, CheckCircle, XCircle, Trash2, ChevronRight } from 'lucide-react';

// 与后端一致的 base_url 规范化
function normalizeBaseUrl(url: string): string {
  let cleaned = url
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/embeddings\/?$/, '')
    .replace(/\/models\/?$/, '')
    .replace(/\/+$/, '');
  try {
    const pathname = new URL(cleaned).pathname;
    if (!/\/v\d+(\/|$)/.test(pathname)) {
      cleaned = cleaned + '/v1';
    }
  } catch { /* URL 无效时不做处理 */ }
  return cleaned.replace(/\/+$/, '');
}

export default function ModelSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState('');
  const [showKey, setShowKey] = useState(false);

  // 弹窗状态
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [showFetchModels, setShowFetchModels] = useState(false);
  const [showSingleTest, setShowSingleTest] = useState(false);
  const [showTestConfirm, setShowTestConfirm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 异步状态
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [fetchedModels, setFetchedModels] = useState<any>(null);
  const [singleTestModelId, setSingleTestModelId] = useState('');
  const [singleTesting, setSingleTesting] = useState(false);
  const [singleTestResult, setSingleTestResult] = useState<{ success: boolean; time: number; error?: string } | null>(null);
  const [testingModels, setTestingModels] = useState(false);
  const [modelTestResults, setModelTestResults] = useState<Record<string, { status: 'success' | 'error'; time: number; error?: string }>>({});

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [p, m] = await Promise.all([
        providersApi.list(), modelsApi.list(),
      ]);
      setProviders(p);
      setModels(m);
      if (!selectedProviderId && p.length > 0) setSelectedProviderId(p[0].id);
    } catch (e) { console.error('加载模型数据失败:', e); }
  };

  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const filteredProviders = providers.filter(p => p.name.toLowerCase().includes(providerSearch.toLowerCase()));
  const providerModels = models.filter(m => m.provider_id === selectedProviderId);

  // ===== 供应商操作 =====
  const handleAddProvider = async (name: string, type: string, baseUrl: string) => {
    const p = await providersApi.create({ name, type, base_url: baseUrl });
    setProviders(prev => [p, ...prev]);
    setSelectedProviderId(p.id);
    setShowAddProvider(false);
  };

  const handleUpdateProvider = async (id: string, updates: Partial<Provider>) => {
    try {
      const p = await providersApi.update(id, updates);
      setProviders(prev => prev.map(x => x.id === id ? p : x));
    } catch (e) { console.error(e); }
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      await providersApi.remove(id);
      setProviders(prev => prev.filter(x => x.id !== id));
      setModels(prev => prev.filter(m => m.provider_id !== id));
      if (selectedProviderId === id) setSelectedProviderId(null);
      setConfirmDeleteId(null);
    } catch (e) { console.error(e); }
  };

  // ===== 模型操作 =====
  const handleAddModel = async (name: string) => {
    if (!selectedProviderId) return;
    try {
      const m = await modelsApi.create({ provider_id: selectedProviderId, name, display_name: name });
      setModels(prev => [...prev, m]);
    } catch (e) { console.error(e); }
  };

  const handleRemoveModel = async (modelId: string) => {
    try {
      await modelsApi.remove(modelId);
      setModels(prev => prev.filter(m => m.id !== modelId));
    } catch (e) { console.error(e); }
  };

  // ===== 单模型测试 =====
  const handleOpenSingleTest = () => {
    setSingleTestResult(null);
    setSingleTestModelId(providerModels.length > 0 ? providerModels[0].id : '');
    setShowSingleTest(true);
  };

  const handleConfirmSingleTest = async () => {
    if (!selectedProviderId || !singleTestModelId) return;
    setSingleTesting(true);
    setSingleTestResult(null);
    try {
      const result = await providersApi.test(selectedProviderId, singleTestModelId);
      setSingleTestResult(result);
    } catch (e) {
      setSingleTestResult({ success: false, time: 0, error: e instanceof Error ? e.message : '测试失败' });
    } finally { setSingleTesting(false); }
  };

  // ===== 获取模型列表 =====
  const handleFetchModels = async () => {
    if (!selectedProviderId) return;
    setShowFetchModels(true);
    setFetching(true);
    setFetchError('');
    setFetchedModels(null);
    try {
      const data = await providersApi.fetchModels(selectedProviderId);
      setFetchedModels(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : '获取模型列表失败');
    } finally { setFetching(false); }
  };

  // ===== 批量健康检测 =====
  const handleConfirmTestModels = async () => {
    if (!selectedProviderId) return;
    setShowTestConfirm(false);
    setTestingModels(true);
    setModelTestResults({});

    await Promise.allSettled(providerModels.map(async (m) => {
      try {
        const result = await providersApi.test(selectedProviderId, m.id);
        setModelTestResults(prev => ({
          ...prev,
          [m.id]: { status: result.success ? 'success' : 'error', time: result.time, error: result.error },
        }));
      } catch (e) {
        setModelTestResults(prev => ({
          ...prev,
          [m.id]: { status: 'error', time: 0, error: e instanceof Error ? e.message : '测试失败' },
        }));
      }
    }));

    setTestingModels(false);
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--chat-bg)' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-2.5 rounded-xl shadow-lg text-sm font-medium"
          style={{ backgroundColor: 'var(--fg)', color: 'var(--bg)' }}>
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-3 opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* ===== 上半部：供应商选择区 ===== */}
      <div className="shrink-0" style={{ padding: '20px 24px 18px', borderBottom: '1px solid var(--border)' }}>
        <div className="setting-group-label" style={{ marginBottom: 10 }}>供应商</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
            <input
              placeholder="搜索供应商..."
              className="w-full pl-9 pr-3 py-2 bg-transparent rounded-lg outline-none"
              style={{ color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}
              value={providerSearch}
              onChange={e => setProviderSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowAddProvider(true)}
            style={{
              padding: '6px 14px', borderRadius: 'var(--radius-full)',
              border: '1px dashed var(--accent)', background: 'transparent',
              fontSize: 12, fontWeight: 500, letterSpacing: '0.01em',
              color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-body)',
              display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-dim)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <Plus className="w-3.5 h-3.5" /> 添加供应商
          </button>
        </div>

        {providers.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted-soft)', letterSpacing: '0.01em', padding: '14px 0' }}>
            尚未添加供应商，点击上方按钮添加。
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {filteredProviders.map(p => {
              const count = models.filter(m => m.provider_id === p.id).length;
              const active = selectedProviderId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProviderId(p.id)}
                  style={{
                    padding: '7px 16px', borderRadius: 'var(--radius-full)',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'var(--accent)' : 'transparent',
                    fontSize: 13, fontWeight: 500, letterSpacing: '0.01em',
                    color: active ? '#fff' : 'var(--muted)', cursor: 'pointer',
                    fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 6,
                    boxShadow: active ? '0 1px 4px rgba(85, 112, 184, 0.2)' : 'none',
                    transition: 'all 0.2s',
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
                  {p.name}
                  <span style={{
                    fontSize: 10, color: active ? '#fff' : 'var(--muted-soft)',
                    fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                    background: active ? 'rgba(255,255,255,0.2)' : 'rgba(70,85,120,0.06)',
                    padding: '1px 6px', borderRadius: 'var(--radius-full)',
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== 下半部：供应商详细配置 ===== */}
      {selectedProvider ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-8 py-6 w-full">
            {/* Provider Header */}
            <div className="flex items-center gap-2 mb-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 style={{
                color: 'var(--fg)', fontFamily: 'var(--font-display)',
                fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em',
              }}>
                {selectedProvider.name}
              </h2>
              <div className="flex-1" />
              <Toggle
                checked={!!selectedProvider.enabled}
                onChange={() => handleUpdateProvider(selectedProvider.id, { enabled: selectedProvider.enabled ? 0 : 1 })}
              />
              {!selectedProvider.is_preset && (
                <button onClick={() => setConfirmDeleteId(selectedProvider.id)}
                  className="p-1.5 rounded-lg transition-colors" title="删除供应商"
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(212,96,106,0.1)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
                  <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                </button>
              )}
            </div>

            <div className="space-y-6">
              {/* API Key */}
              <FormSection label="API 密钥">
                <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <div className="relative flex-1">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={selectedProvider.api_key}
                      onChange={e => handleUpdateProvider(selectedProvider.id, { api_key: e.target.value })}
                      className="w-full px-4 py-2.5 border-none outline-none bg-transparent"
                      style={{ color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}
                      placeholder="sk-..."
                    />
                    <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-2.5" style={{ color: 'var(--muted)' }}>
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button type="button" onClick={handleOpenSingleTest}
                    className="px-4 border-l font-medium transition-colors"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
                    测试
                  </button>
                </div>
              </FormSection>

              {/* Base URL */}
              <FormSection label="API 地址">
                <input
                  value={selectedProvider.base_url}
                  onChange={e => handleUpdateProvider(selectedProvider.id, { base_url: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}
                  placeholder="https://api.openai.com/v1"
                  onFocus={e => {
                    (e.target as HTMLElement).style.borderColor = 'var(--accent)';
                    (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)';
                  }}
                  onBlur={e => {
                    (e.target as HTMLElement).style.borderColor = 'var(--border)';
                    (e.target as HTMLElement).style.boxShadow = 'none';
                  }}
                />
                {selectedProvider.base_url && (
                  <p className="mt-1.5" style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>
                    聊天地址: <span style={{ color: 'var(--accent)' }}>{normalizeBaseUrl(selectedProvider.base_url)}/chat/completions</span>
                  </p>
                )}
              </FormSection>

              {/* 模型列表 */}
              <FormSection label={
                <div className="flex items-center gap-2">
                  模型
                  <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'var(--sidebar-bg)', color: 'var(--muted)' }}>
                    {providerModels.length}
                  </span>
                  {providerModels.length > 0 && (
                    <button onClick={() => setShowTestConfirm(true)} disabled={testingModels}
                      className="p-1 rounded transition-colors" style={{ color: 'var(--muted)' }} title="模型健康检测"
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--muted)'}>
                      {testingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              }>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                    <button onClick={handleFetchModels} disabled={fetching}
                      className="flex items-center gap-1 px-3 py-1.5 font-medium transition-colors"
                      style={{ color: 'var(--fg)', fontSize: 11, fontFamily: 'var(--font-body)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
                      <RefreshCw className={cn("w-3.5 h-3.5", fetching && "animate-spin")} />
                      获取模型列表
                    </button>
                    <div className="w-px" style={{ backgroundColor: 'var(--border)' }} />
                    <button onClick={() => setShowAddModel(true)}
                      className="px-3 py-1.5 font-medium transition-colors"
                      style={{ color: 'var(--accent)', fontSize: 11, fontFamily: 'var(--font-body)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent-dim)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {fetchError && <p className="mb-3" style={{ fontSize: 11, color: 'var(--danger)' }}>{fetchError}</p>}

                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  {providerModels.map(m => {
                    const test = modelTestResults[m.id];
                    return (
                      <div key={m.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0 transition-colors"
                        style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-3">
                          <Box className="w-4 h-4" style={{ color: 'var(--muted)' }} />
                          <span className="font-medium" style={{ color: 'var(--fg)', fontSize: 13, letterSpacing: '-0.01em' }}>{m.display_name || m.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {testingModels && !test && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--muted)' }} />}
                          {test && test.status === 'success' && (
                            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }} title={`${test.time}ms`}>
                              <CheckCircle className="w-3.5 h-3.5" /> {test.time}ms
                            </span>
                          )}
                          {test && test.status === 'error' && (
                            <span className="flex items-center gap-1 text-xs cursor-help" style={{ color: 'var(--danger)' }} title={test.error || '未知错误'}>
                              <XCircle className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <button onClick={() => handleRemoveModel(m.id)}
                            className="p-1 rounded transition-colors"
                            style={{ color: 'var(--muted)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(212,96,106,0.1)'; (e.currentTarget as HTMLElement).style.color = 'var(--danger)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}>
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {providerModels.length === 0 && (
                    <div className="p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>暂无模型，点击上方按钮获取或添加。</div>
                  )}
                </div>
              </FormSection>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--muted-soft)', fontSize: 13, letterSpacing: '0.01em' }}>
          ← 请在上方选择一个供应商
        </div>
      )}

      {/* ===== 弹窗 ===== */}
      {showAddProvider && (
        <AddProviderModal onClose={() => setShowAddProvider(false)} onSave={handleAddProvider} />
      )}
      {showAddModel && selectedProviderId && (
        <AddModelModal
          onClose={() => setShowAddModel(false)}
          onSave={handleAddModel}
          onValidate={(modelName: string) => providersApi.validateModel(selectedProviderId, modelName)}
        />
      )}
      {showFetchModels && selectedProvider && (
        <FetchModelsModal
          providerName={selectedProvider.name}
          models={fetchedModels}
          existingModelNames={providerModels.map(m => m.name)}
          loading={fetching}
          error={fetchError}
          onClose={() => { setShowFetchModels(false); setFetchedModels(null); setFetchError(''); }}
          onAddModel={handleAddModel}
          onAddSelected={async (names: string[]) => {
            for (const name of names) await handleAddModel(name);
            setShowFetchModels(false);
            setFetchedModels(null);
          }}
        />
      )}
      {showSingleTest && selectedProvider && (
        <SingleTestModal
          providerModels={providerModels}
          singleTestModelId={singleTestModelId}
          singleTesting={singleTesting}
          singleTestResult={singleTestResult}
          onClose={() => setShowSingleTest(false)}
          onChangeModel={setSingleTestModelId}
          onConfirm={handleConfirmSingleTest}
        />
      )}
      {showTestConfirm && (
        <TestConfirmModal
          modelCount={providerModels.length}
          onClose={() => setShowTestConfirm(false)}
          onConfirm={handleConfirmTestModels}
        />
      )}
      {confirmDeleteId && selectedProvider && (
        <DeleteProviderModal
          providerName={selectedProvider.name}
          onClose={() => setConfirmDeleteId(null)}
          onConfirm={() => handleDeleteProvider(confirmDeleteId)}
        />
      )}
    </div>
  );
}

// ===== 内联表单组件 =====
function FormSection({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block uppercase" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--muted-soft)', marginBottom: 12 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ===== 弹窗：添加供应商 =====
function AddProviderModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, type: string, baseUrl: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('OpenAI');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try { await onSave(name.trim(), type, ''); } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ backgroundColor: 'rgba(50,58,85,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="rounded-[18px] w-full max-w-[400px] flex flex-col" style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)' }}>
        <div className="flex justify-between items-center border-b" style={{ padding: '18px 22px', borderColor: 'var(--border)' }}>
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>添加提供商</h3>
          <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="space-y-4" style={{ padding: 22 }}>
          <div>
            <label className="block uppercase" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--muted-soft)', marginBottom: 6 }}>名称</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 rounded-lg border outline-none"
              style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}
              placeholder="例如 通义千问"
              onFocus={e => { (e.target as HTMLElement).style.borderColor = 'var(--accent)'; (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)'; }}
              onBlur={e => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.boxShadow = 'none'; }} />
          </div>
          <div>
            <label className="block uppercase" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--muted-soft)', marginBottom: 6 }}>类型</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border outline-none"
              style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
              <option value="OpenAI">OpenAI</option>
              <option value="Ollama">Ollama</option>
              <option value="Custom">自定义</option>
            </select>
          </div>
          {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
          <p className="text-xs" style={{ color: 'var(--muted)' }}>添加后可在下方配置 API 地址和密钥</p>
        </div>
        <div className="flex justify-end gap-3 border-t" style={{ padding: '14px 22px', borderColor: 'var(--border)' }}>
          <BtnSecondary onClick={onClose}>取消</BtnSecondary>
          <BtnPrimary onClick={handleSave} disabled={loading || !name.trim()}>
            {loading ? '添加中...' : '确定'}
          </BtnPrimary>
        </div>
      </div>
    </div>
  );
}

// ===== 弹窗：添加模型 =====
function AddModelModal({ onClose, onSave, onValidate }: {
  onClose: () => void; onSave: (name: string) => void;
  onValidate: (name: string) => Promise<{ valid: boolean; time?: number; error?: string }>;
}) {
  const [name, setName] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!name.trim()) return;
    setValidating(true);
    setError('');
    try {
      const result = await onValidate(name.trim());
      if (result.valid) { onSave(name.trim()); } else { setError(result.error || '模型验证失败'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证请求失败');
    } finally { setValidating(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ backgroundColor: 'rgba(50,58,85,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="rounded-[18px] w-full max-w-[400px] flex flex-col" style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)' }}>
        <div className="flex justify-between items-center border-b" style={{ padding: '18px 22px', borderColor: 'var(--border)' }}>
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>添加模型</h3>
          <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div style={{ padding: 22 }}>
          <label className="block uppercase" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--muted-soft)', marginBottom: 8 }}>模型标识 (Model ID)</label>
          <input value={name} onChange={e => { setName(e.target.value); setError(''); }} autoFocus
            className="w-full px-3 py-2.5 rounded-lg border outline-none"
            style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}
            placeholder="例如 gpt-4o"
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            onFocus={e => { (e.target as HTMLElement).style.borderColor = 'var(--accent)'; (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)'; }}
            onBlur={e => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.boxShadow = 'none'; }} />
          {error && <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t" style={{ padding: '14px 22px', borderColor: 'var(--border)' }}>
          <BtnSecondary onClick={onClose}>取消</BtnSecondary>
          <BtnPrimary onClick={handleConfirm} disabled={validating || !name.trim()}>
            {validating ? '验证中...' : '确定'}
          </BtnPrimary>
        </div>
      </div>
    </div>
  );
}

// ===== 弹窗：获取模型列表 =====
function FetchModelsModal({
  providerName, models, existingModelNames, loading, error, onClose, onAddModel, onAddSelected,
}: {
  providerName: string; models: any; existingModelNames: string[]; loading: boolean; error: string;
  onClose: () => void; onAddModel: (name: string) => void; onAddSelected: (names: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const extractGroup = (id: string): string => {
    const slashIdx = id.indexOf('/');
    if (slashIdx !== -1) return id.slice(0, slashIdx);
    const match = id.match(/^[A-Za-z]+/);
    return match ? match[0] : '其他';
  };

  const groups: Record<string, any[]> = {};
  if (models?.data) {
    for (const model of models.data) {
      const group = extractGroup(model.id || model.name || '');
      if (!groups[group]) groups[group] = [];
      groups[group].push(model);
    }
  }

  const allModels = models?.data || [];
  const categories = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);

  const filteredGroups: Record<string, any[]> = {};
  if (activeCategory === 'all') {
    for (const cat of categories) {
      const filtered = groups[cat].filter((m: any) => !searchText || (m.id || m.name || '').toLowerCase().includes(searchText.toLowerCase()));
      if (filtered.length > 0) filteredGroups[cat] = filtered;
    }
  } else {
    const filtered = (groups[activeCategory] || []).filter((m: any) => !searchText || (m.id || m.name || '').toLowerCase().includes(searchText.toLowerCase()));
    if (filtered.length > 0) filteredGroups[activeCategory] = filtered;
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const selectAll = () => {
    const allIds = new Set<string>();
    for (const ms of Object.values(filteredGroups)) { for (const m of ms) { allIds.add(m.id || m.name); } }
    setSelectedIds(allIds);
  };

  const isSelected = (id: string) => selectedIds.has(id);
  const isExisting = (id: string) => existingModelNames.includes(id);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(50,58,85,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="rounded-[18px] w-full max-w-[700px] flex flex-col" style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)', height: '760px' }}>
        <div className="px-6 py-4 border-b flex justify-between items-center shrink-0" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>{providerName} 模型</h3>
          <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Search & Tabs */}
        <div className="px-6 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4" style={{ color: 'var(--muted)' }} />
              <input placeholder="搜索模型 ID 或名称"
                className="w-full pl-10 pr-3 py-2 rounded-lg border outline-none"
                style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}
                value={searchText} onChange={e => setSearchText(e.target.value)} />
            </div>
            <div className="flex items-center gap-1">
              <button onClick={selectAll} className="px-2 py-1 rounded text-xs border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>全选</button>
              <button onClick={() => setSelectedIds(new Set())} className="px-2 py-1 rounded text-xs border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>取消</button>
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setActiveCategory('all')}
              className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors"
              style={{
                backgroundColor: activeCategory === 'all' ? 'var(--accent)' : 'transparent',
                borderColor: 'var(--border)',
                color: activeCategory === 'all' ? '#fff' : 'var(--muted)',
                border: activeCategory === 'all' ? 'none' : '1px solid var(--border)',
              }}>全部</button>
            {categories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors"
                style={{
                  backgroundColor: activeCategory === cat ? 'var(--accent)' : 'transparent',
                  borderColor: 'var(--border)',
                  color: activeCategory === cat ? '#fff' : 'var(--muted)',
                  border: activeCategory === cat ? 'none' : '1px solid var(--border)',
                }}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</button>
            ))}
          </div>
        </div>

        {/* Model list */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="text-sm" style={{ color: 'var(--muted)' }}>正在获取模型列表...</span>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--danger)' }}>获取失败</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{error}</p>
            </div>
          ) : models && Object.entries(filteredGroups).length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>未找到匹配的模型</div>
          ) : models ? (
            Object.entries(filteredGroups).map(([category, catModels]) => (
              <div key={category} className="mb-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{category.charAt(0).toUpperCase() + category.slice(1)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--chat-bg)', color: 'var(--muted-soft)' }}>{catModels.length}</span>
                  <ChevronRight className="w-3 h-3" style={{ color: 'var(--muted-soft)' }} />
                </div>
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  {catModels.map((model: any) => {
                    const modelId = model.id || model.name;
                    const selected = isSelected(modelId);
                    const exists = isExisting(modelId);
                    return (
                      <div key={modelId} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0 transition-colors"
                        style={{ borderColor: 'var(--border)', backgroundColor: selected ? 'var(--accent-dim)' : 'transparent' }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <button onClick={() => toggleSelect(modelId)}
                            className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors"
                            style={{ borderColor: selected ? 'var(--accent)' : 'var(--border)', backgroundColor: selected ? 'var(--accent)' : 'transparent' }}>
                            {selected && <span className="text-white text-[10px]">✓</span>}
                          </button>
                          <span className="text-sm font-medium truncate" style={{ color: exists ? 'var(--muted-soft)' : 'var(--fg)' }}>{modelId}</span>
                          {exists && <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ color: 'var(--muted-soft)', borderColor: 'var(--border)' }}>已添加</span>}
                        </div>
                        <button onClick={() => { if (!exists) onAddModel(modelId); }}
                          className="p-1 rounded transition-colors shrink-0"
                          style={{ color: 'var(--accent)', opacity: exists ? 0.3 : 1, cursor: exists ? 'not-allowed' : 'pointer' }}>
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          ) : null}
        </div>

        <div className="flex justify-between items-center shrink-0 border-t" style={{ padding: '14px 22px', borderColor: 'var(--border)' }}>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>已选择 {selectedIds.size} 个模型</span>
          <div className="flex gap-3">
            <BtnSecondary onClick={onClose}>取消</BtnSecondary>
            <BtnPrimary onClick={() => onAddSelected(Array.from(selectedIds))} disabled={selectedIds.size === 0}>添加选中的模型</BtnPrimary>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 弹窗：单模型测试 =====
function SingleTestModal({ providerModels, singleTestModelId, singleTesting, singleTestResult, onClose, onChangeModel, onConfirm }: {
  providerModels: Model[]; singleTestModelId: string; singleTesting: boolean;
  singleTestResult: { success: boolean; time: number; error?: string } | null;
  onClose: () => void; onChangeModel: (id: string) => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(50,58,85,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="rounded-[18px] w-full max-w-[440px] flex flex-col" style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)' }}>
        <div className="flex justify-between items-center border-b" style={{ padding: '18px 22px', borderColor: 'var(--border)' }}>
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>模型连通性测试</h3>
          <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="space-y-4" style={{ padding: 22 }}>
          {providerModels.length > 0 ? (
            <>
              <div>
                <label className="block uppercase" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--muted-soft)', marginBottom: 6 }}>选择模型</label>
                <select value={singleTestModelId} onChange={e => onChangeModel(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--chat-bg)', borderColor: 'var(--border)', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
                  {providerModels.map(m => <option key={m.id} value={m.id}>{m.display_name || m.name}</option>)}
                </select>
              </div>
              <div className="p-3 rounded-lg border" style={{ backgroundColor: 'rgba(201,164,59,0.1)', borderColor: 'var(--warn)' }}>
                <p className="text-sm font-medium" style={{ color: '#92400e' }}>测试需要发送真实请求，请谨慎使用。</p>
                <p className="text-sm mt-1" style={{ color: '#a16207' }}>按次收费的模型可能产生费用，请自行承担。</p>
              </div>
              {singleTestResult && (
                <div className="p-3 rounded-lg border" style={{
                  backgroundColor: singleTestResult.success ? 'rgba(74,158,110,0.08)' : 'rgba(212,96,106,0.08)',
                  borderColor: singleTestResult.success ? 'var(--success)' : 'var(--danger)',
                }}>
                  {singleTestResult.success ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5" style={{ color: 'var(--success)' }} />
                      <span className="text-sm font-medium" style={{ color: 'var(--success)' }}>连接成功 ({singleTestResult.time}ms)</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <XCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
                      <div>
                        <span className="text-sm font-medium" style={{ color: 'var(--danger)' }}>连接失败</span>
                        {singleTestResult.error && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{singleTestResult.error}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--muted)' }}>暂无模型</p>
              <p className="text-xs" style={{ color: 'var(--muted-soft)' }}>请先通过"获取模型列表"或"+"按钮添加模型</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t" style={{ padding: '14px 22px', borderColor: 'var(--border)' }}>
          <BtnSecondary onClick={onClose}>取消</BtnSecondary>
          {providerModels.length > 0 && (
            <button onClick={onConfirm} disabled={singleTesting || !singleTestModelId}
              className="inline-flex items-center justify-center font-medium transition-all duration-150 select-none disabled:opacity-25 disabled:pointer-events-none"
              style={{
                padding: '9px 18px', borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--success), #3d8a5e)', color: '#fff',
                fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-button)',
              }}>
              {singleTesting ? '测试中...' : '开始'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 弹窗：批量测试确认 =====
function TestConfirmModal({ modelCount, onClose, onConfirm }: { modelCount: number; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(50,58,85,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="rounded-[18px] w-full max-w-[440px] flex flex-col" style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)' }}>
        <div className="flex justify-between items-center border-b" style={{ padding: '18px 22px', borderColor: 'var(--border)' }}>
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>模型健康检测</h3>
          <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="space-y-4" style={{ padding: 22 }}>
          <div className="p-3 rounded-lg border" style={{ backgroundColor: 'rgba(201,164,59,0.1)', borderColor: 'var(--warn)' }}>
            <p className="text-sm font-medium" style={{ color: '#92400e' }}>健康检查需要发送请求，请谨慎使用。</p>
            <p className="text-sm mt-1" style={{ color: '#a16207' }}>按次收费的模型可能产生更多费用，请自行承担。</p>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>将对当前列表中的 {modelCount} 个模型逐一发送测试请求，每次最多等待 15 秒。</p>
        </div>
        <div className="flex justify-end gap-3 border-t" style={{ padding: '14px 22px', borderColor: 'var(--border)' }}>
          <BtnSecondary onClick={onClose}>取消</BtnSecondary>
          <button onClick={onConfirm}
            className="inline-flex items-center justify-center font-medium transition-all duration-150 select-none"
            style={{
              padding: '9px 18px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, var(--success), #3d8a5e)',
              color: '#fff', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-button)',
            }}>开始</button>
        </div>
      </div>
    </div>
  );
}

// ===== 弹窗：删除供应商确认 =====
function DeleteProviderModal({ providerName, onClose, onConfirm }: { providerName: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(50,58,85,0.4)', backdropFilter: 'blur(2px)' }}>
      <div className="rounded-[18px] w-full max-w-[400px] flex flex-col" style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)' }}>
        <div className="flex justify-between items-center border-b" style={{ padding: '18px 22px', borderColor: 'var(--border)' }}>
          <h3 className="text-[17px] font-semibold" style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>删除供应商</h3>
          <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div style={{ padding: 22 }}>
          <p className="text-sm" style={{ color: 'var(--fg)' }}>确认删除供应商 <span style={{ fontWeight: 600 }}>{providerName}</span>？</p>
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>该供应商下的所有模型也将被删除，此操作不可撤销。</p>
        </div>
        <div className="flex justify-end gap-3 border-t" style={{ padding: '14px 22px', borderColor: 'var(--border)' }}>
          <BtnSecondary onClick={onClose}>取消</BtnSecondary>
          <BtnDanger onClick={onConfirm}>确认删除</BtnDanger>
        </div>
      </div>
    </div>
  );
}
