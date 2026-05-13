import { useState, useEffect, useRef } from 'react';
import type { Provider, Model, MemorySettings, MemoryEntry } from '../types';
import { cn } from '../lib/utils';
import { providersApi, modelsApi, memoryApi, profileApi, settingsApi } from '../services/api';
import { Search, Plus, Eye, EyeOff, Minus, Settings, Brain, Box, Upload, X, ChevronRight, FileText, RefreshCw, Activity, Loader2, CheckCircle, XCircle, Trash2, MoreHorizontal, Pencil, ExternalLink, User, Globe } from 'lucide-react';
import ModelSelectModal from './shared/ModelSelectModal';

// ===== 通用 Toggle 组件 =====
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button" onClick={onChange}
      className={cn("w-11 h-6 rounded-full transition-colors relative")}
      style={{ backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-border)' }}
    >
      <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
        checked ? "left-[22px]" : "left-1")} />
    </button>
  );
}

// 与后端一致的 base_url 规范化逻辑，用于前端预览
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

interface SettingsAreaProps {
  activeTab: 'model' | 'memory' | 'profile';
}

export default function SettingsArea({ activeTab }: SettingsAreaProps) {
  // ===== 模型设置状态 =====
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState('');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [showFetchModels, setShowFetchModels] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [showSingleTest, setShowSingleTest] = useState(false);
  const [singleTestModelId, setSingleTestModelId] = useState('');
  const [singleTesting, setSingleTesting] = useState(false);
  const [singleTestResult, setSingleTestResult] = useState<{ success: boolean; time: number; error?: string } | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [fetchedModels, setFetchedModels] = useState<any>(null);
  const [testingModels, setTestingModels] = useState(false);
  const [showTestConfirm, setShowTestConfirm] = useState(false);
  const [modelTestResults, setModelTestResults] = useState<Record<string, { status: 'success' | 'error'; time: number; error?: string }>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Toast 提示
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 5000);
  };

  // ===== 记忆状态 =====
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memorySearch, setMemorySearch] = useState('');
  const [showMemorySettings, setShowMemorySettings] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryEntry | null>(null);
  const [viewingMemoryId, setViewingMemoryId] = useState<string | null>(null);
  const [memoryDetail, setMemoryDetail] = useState<any | null>(null);
  const [loadingMemoryDetail, setLoadingMemoryDetail] = useState(false);
  const [confirmDeleteMemoryId, setConfirmDeleteMemoryId] = useState<string | null>(null);

  // ===== IQS Key 状态 =====
  const [iqsKeyConfigured, setIqsKeyConfigured] = useState(false);
  const [iqsKeyMasked, setIqsKeyMasked] = useState('');
  const [iqsKeyInput, setIqsKeyInput] = useState('');
  const [iqsKeySaving, setIqsKeySaving] = useState(false);

  // ===== 个人信息状态 =====
  const [profileEntries, setProfileEntries] = useState<{ key: string; value: string }[]>([]);
  const [editingProfile, setEditingProfile] = useState<{ key: string; value: string } | null>(null);
  const [showAddProfile, setShowAddProfile] = useState(false);

  // 加载数据
  useEffect(() => {
    loadProviders();
    loadMemoryData();
    loadProfileData();
    loadIqsKeyStatus();
  }, []);

  const loadProviders = async () => {
    try {
      const [p, m] = await Promise.all([providersApi.list(), modelsApi.list()]);
      setProviders(p);
      setModels(m);
      if (!selectedProviderId && p.length > 0) setSelectedProviderId(p[0].id);
    } catch (e) { console.error('加载提供商失败:', e); }
  };

  const loadMemoryData = async () => {
    try {
      const [settings, mems] = await Promise.all([memoryApi.getSettings(), memoryApi.list()]);
      setMemorySettings(settings);
      setMemories(mems);
    } catch (e) { console.error('加载记忆失败:', e); }
  };

  const loadProfileData = async () => {
    try {
      const entries = await profileApi.list();
      setProfileEntries(entries);
    } catch (e) { console.error('加载个人信息失败:', e); }
  };

  const loadIqsKeyStatus = async () => {
    try {
      const result = await settingsApi.getIqsKey();
      setIqsKeyConfigured(result.configured);
      setIqsKeyMasked(result.masked || '');
    } catch (e) { console.error('加载 IQS Key 状态失败:', e); }
  };

  const handleSaveIqsKey = async () => {
    if (!iqsKeyInput.trim()) return;
    setIqsKeySaving(true);
    try {
      const result = await settingsApi.updateIqsKey(iqsKeyInput.trim());
      setIqsKeyConfigured(result.configured);
      setIqsKeyInput('');
      showToast('IQS API Key 已保存');
    } catch (e: any) {
      showToast(e.message || '保存失败');
    } finally {
      setIqsKeySaving(false);
    }
  };

  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const filteredProviders = providers.filter(p => p.name.toLowerCase().includes(providerSearch.toLowerCase()));
  const providerModels = models.filter(m => m.provider_id === selectedProviderId);

  const handleAddProvider = async (name: string, type: string, baseUrl: string): Promise<void> => {
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
      if (selectedProviderId === id) {
        setSelectedProviderId(null);
      }
      setConfirmDeleteId(null);
    } catch (e) { console.error(e); }
  };

  const handleAddModel = async (name: string) => {
    if (!selectedProviderId) return;
    try {
      const m = await modelsApi.create({ provider_id: selectedProviderId, name, display_name: name });
      setModels(prev => [...prev, m]);
    } catch (e) { console.error(e); }
  };

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
    } finally {
      setSingleTesting(false);
    }
  };

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
    } finally {
      setFetching(false);
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    try {
      await modelsApi.remove(modelId);
      setModels(prev => prev.filter(m => m.id !== modelId));
    } catch (e) { console.error(e); }
  };

  const handleTestModels = async () => {
    if (!selectedProviderId) return;
    setShowTestConfirm(true);
  };

  const handleConfirmTestModels = async () => {
    if (!selectedProviderId) return;
    setShowTestConfirm(false);
    setTestingModels(true);
    setModelTestResults({});

    // 并发测试所有模型，每个模型结果实时更新
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

  const handleUpdateMemorySettings = async (updates: Partial<MemorySettings>) => {
    try {
      const s = await memoryApi.updateSettings(updates);
      setMemorySettings(s);
      setShowMemorySettings(false);
    } catch (e) { console.error(e); }
  };

  const handleViewMemorySources = async (memoryId: string) => {
    setViewingMemoryId(memoryId);
    setMemoryDetail(null);
    setLoadingMemoryDetail(true);
    try {
      const detail = await memoryApi.getDetail(memoryId);
      setMemoryDetail(detail);
    } catch (e) { console.error('加载记忆详情失败:', e); }
    finally { setLoadingMemoryDetail(false); }
  };

  const handleUpdateMemory = async (memoryId: string, content: string) => {
    try {
      await memoryApi.update(memoryId, content);
      await loadMemoryData();
      setEditingMemory(null);
    } catch (e) { console.error(e); }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      await memoryApi.remove(memoryId);
      await loadMemoryData();
      setConfirmDeleteMemoryId(null);
    } catch (e) { console.error(e); }
  };

  const handleAddProfile = async (key: string, value: string) => {
    try {
      await profileApi.update({ [key]: value });
      await loadProfileData();
      setShowAddProfile(false);
    } catch (e) { console.error(e); }
  };

  const handleUpdateProfile = async (key: string, value: string) => {
    try {
      await profileApi.update({ [key]: value });
      await loadProfileData();
      setEditingProfile(null);
    } catch (e) { console.error(e); }
  };

  const handleDeleteProfile = async (key: string) => {
    try {
      await profileApi.remove(key);
      await loadProfileData();
    } catch (e) { console.error(e); }
  };

  const bgSoft = 'var(--color-background-soft)';
  const bgMute = 'var(--color-background-mute)';
  const borderColor = 'var(--color-border)';
  const textColor = 'var(--color-text)';
  const textSecondary = 'var(--color-text-2)';
  const primaryColor = 'var(--color-primary)';

  return (
    <div className="flex-1 flex h-full overflow-hidden" style={{ backgroundColor: bgSoft }}>
      {/* Toast 提示 */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-2.5 rounded-xl shadow-lg text-sm font-medium transition-all duration-300"
          style={{ backgroundColor: 'var(--color-text)', color: 'var(--color-background)', opacity: toastMessage ? 1 : 0 }}>
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="ml-3 opacity-60 hover:opacity-100 transition-opacity">&times;</button>
        </div>
      )}

      {/* ===== 模型设置 Tab ===== */}
      {activeTab === 'model' && (
        <div className="flex h-full w-full overflow-hidden">
          {/* Left: Provider List */}
          <div className="w-[240px] flex flex-col border-r shrink-0" style={{ borderColor, backgroundColor: bgMute }}>
            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5" style={{ color: textSecondary }} />
                <input
                  placeholder="搜索提供商..."
                  className="w-full pl-9 pr-3 py-2 bg-transparent rounded-lg text-sm outline-none"
                  style={{ color: textColor }}
                  value={providerSearch}
                  onChange={e => setProviderSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {filteredProviders.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProviderId(p.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors"
                  style={{
                    backgroundColor: selectedProviderId === p.id ? 'var(--color-primary-mute)' : 'transparent',
                    color: selectedProviderId === p.id ? primaryColor : textColor,
                  }}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{
                    color: p.enabled ? primaryColor : textSecondary,
                    borderColor: p.enabled ? 'var(--color-primary-soft)' : borderColor,
                  }}>
                    {p.enabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              ))}
            </div>
            <div className="p-3 border-t" style={{ borderColor }}>
              <button
                onClick={() => setShowAddProvider(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium border transition-colors hover:opacity-80"
                style={{ borderColor, color: textColor }}
              >
                <Plus className="w-4 h-4" /> 添加
              </button>
            </div>

            {/* IQS 联网搜索 Key */}
            <div className="p-3 border-t" style={{ borderColor }}>
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-3.5 h-3.5" style={{ color: textSecondary }} />
                <span className="text-xs font-medium" style={{ color: textSecondary }}>IQS 搜索 Key</span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", iqsKeyConfigured ? 'text-green-600 bg-green-50' : 'text-yellow-600 bg-yellow-50')}>
                  {iqsKeyConfigured ? '已配置' : '未配置'}
                </span>
              </div>
              {iqsKeyConfigured ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1.5 rounded text-xs bg-black/5 truncate" style={{ color: textSecondary, fontSize: '10px' }}>
                      {iqsKeyMasked}
                    </code>
                    <button
                      onClick={() => { setIqsKeyConfigured(false); setIqsKeyInput(''); }}
                      className="text-xs transition-colors hover:opacity-70 shrink-0"
                      style={{ color: '#ef4444' }}>
                      移除
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={iqsKeyInput}
                    onChange={e => setIqsKeyInput(e.target.value)}
                    placeholder="输入 IQS API Key..."
                    className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
                    style={{ borderColor, color: textColor, backgroundColor: 'var(--color-background)' }}
                  />
                  <button
                    onClick={handleSaveIqsKey}
                    disabled={iqsKeySaving || !iqsKeyInput.trim()}
                    className="w-full py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-40 text-white"
                    style={{ backgroundColor: primaryColor }}>
                    {iqsKeySaving ? '保存中...' : '保存'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Config */}
          {selectedProvider ? (
            <div className="flex-1 overflow-y-auto">
              <div className="px-8 py-6 w-full">
                <div className="flex items-center gap-2 mb-6 pb-4 border-b" style={{ borderColor }}>
                  <h2 className="text-lg font-bold" style={{ color: textColor }}>{selectedProvider.name}</h2>
                  <div className="flex-1" />
                  {!selectedProvider.is_preset && (
                    <button onClick={() => setConfirmDeleteId(selectedProvider.id)}
                      className="p-1 rounded transition-colors hover:opacity-70" title="删除供应商">
                      <Trash2 className="w-4 h-4" style={{ color: '#ef4444' }} />
                    </button>
                  )}
                  <Toggle
                    checked={!!selectedProvider.enabled}
                    onChange={() => handleUpdateProvider(selectedProvider.id, { enabled: selectedProvider.enabled ? 0 : 1 })}
                  />
                </div>

                <div className="space-y-6">
                  {/* API Key */}
                  <div>
                    <label className="block text-sm font-bold mb-2" style={{ color: textColor }}>API 密钥</label>
                    <div className="flex rounded-lg border overflow-hidden" style={{ borderColor }}>
                      <div className="relative flex-1">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={selectedProvider.api_key}
                          onChange={e => handleUpdateProvider(selectedProvider.id, { api_key: e.target.value })}
                          className="w-full px-4 py-2.5 border-none outline-none bg-transparent text-sm"
                          style={{ color: textColor }}
                          placeholder="sk-..."
                        />
                        <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-2.5"
                          style={{ color: textSecondary }}>
                          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button onClick={handleOpenSingleTest}
                        className="px-4 border-l text-sm font-medium transition-colors hover:opacity-80"
                        style={{ borderColor, color: textSecondary }}>
                        测试
                      </button>
                    </div>
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="block text-sm font-bold mb-2" style={{ color: textColor }}>API 地址</label>
                    <input
                      value={selectedProvider.base_url}
                      onChange={e => handleUpdateProvider(selectedProvider.id, { base_url: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-lg border outline-none text-sm focus:ring-2"
                      style={{ backgroundColor: 'var(--color-background)', borderColor, color: textColor, '--tw-ring-color': primaryColor } as React.CSSProperties}
                      placeholder="https://api.openai.com/v1"
                    />
                    {selectedProvider.base_url && (
                      <p className="text-xs mt-1.5" style={{ color: textSecondary }}>
                        聊天地址: <span style={{ color: 'var(--color-primary)' }}>{normalizeBaseUrl(selectedProvider.base_url)}/chat/completions</span>
                      </p>
                    )}
                  </div>

                  {/* Models */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center gap-2 text-sm font-bold" style={{ color: textColor }}>
                        模型
                        <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: bgMute, color: textSecondary }}>
                          {providerModels.length}
                        </span>
                        {providerModels.length > 0 && (
                          <button onClick={handleTestModels} disabled={testingModels}
                            className="p-1 rounded transition-colors hover:opacity-80 disabled:opacity-50"
                            style={{ color: textSecondary }} title="模型健康检测">
                            {testingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor }}>
                          <button onClick={handleFetchModels} disabled={fetching}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
                            style={{ color: textColor }}>
                            <RefreshCw className={cn("w-3.5 h-3.5", fetching && "animate-spin")} />
                            获取模型列表
                          </button>
                          <div className="w-px" style={{ backgroundColor: borderColor }} />
                          <button onClick={() => setShowAddModel(true)}
                            className="px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                            style={{ color: primaryColor }}>
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {fetchError && (
                      <p className="text-xs mb-3" style={{ color: '#ef4444' }}>{fetchError}</p>
                    )}
                    <div className="rounded-xl border overflow-hidden mb-3" style={{ borderColor }}>
                      {providerModels.map(m => {
                        const test = modelTestResults[m.id];
                        return (
                        <div key={m.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0 transition-colors"
                          style={{ borderColor }}>
                          <div className="flex items-center gap-3">
                            <Box className="w-4 h-4" style={{ color: textSecondary }} />
                            <span className="text-sm font-medium" style={{ color: textColor }}>{m.display_name || m.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {testingModels && !test && (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: textSecondary }} />
                            )}
                            {test && test.status === 'success' && (
                              <span className="flex items-center gap-1 text-xs" style={{ color: '#22c55e' }} title={`${test.time}ms`}>
                                <CheckCircle className="w-3.5 h-3.5" /> {test.time}ms
                              </span>
                            )}
                            {test && test.status === 'error' && (
                              <span className="flex items-center gap-1 text-xs cursor-help" style={{ color: '#ef4444' }} title={test.error || '未知错误'}>
                                <XCircle className="w-3.5 h-3.5" />
                              </span>
                            )}
                            <button onClick={() => handleRemoveModel(m.id)}
                              className="p-1 rounded transition-colors hover:bg-red-50" style={{ color: textSecondary }}>
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        );
                      })}
                      {providerModels.length === 0 && (
                        <div className="p-6 text-center text-sm" style={{ color: textSecondary }}>暂无模型</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center" style={{ color: textSecondary }}>
              请选择左侧提供商
            </div>
          )}
        </div>
      )}

      {/* ===== 全局记忆 Tab ===== */}
      {activeTab === 'memory' && (
        <div className="flex flex-col h-full w-full overflow-hidden p-4 gap-4">
          {/* Header */}
          <div className="rounded-xl border p-4 flex items-center justify-between shrink-0"
            style={{ backgroundColor: 'var(--color-background)', borderColor }}>
            <div className="text-lg font-bold" style={{ color: textColor }}>全局记忆</div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={memorySettings?.enabled === 1}
                onChange={() => handleUpdateMemorySettings({ enabled: memorySettings?.enabled === 1 ? 0 : 1 })}
              />
              <Settings className="w-5 h-5 cursor-pointer hover:opacity-70 transition-all"
                style={{ color: textSecondary }}
                onClick={() => setShowMemorySettings(true)} />
            </div>
          </div>

          {/* Memory List */}
          <div className="flex-1 rounded-xl border flex flex-col overflow-hidden"
            style={{ backgroundColor: 'var(--color-background)', borderColor }}>
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor }}>
              <div className="text-sm font-medium" style={{ color: textColor }}>
                记忆条目 ({memories.length})
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5" style={{ color: textSecondary }} />
                <input
                  placeholder="搜索记忆..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm outline-none"
                  style={{ borderColor, color: textColor, backgroundColor: bgSoft }}
                  value={memorySearch}
                  onChange={e => setMemorySearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: bgMute }}>
                  <tr style={{ color: textSecondary }}>
                    <th className="px-4 py-3 text-left font-medium">内容</th>
                    <th className="px-4 py-3 text-left font-medium w-20">主题</th>
                    <th className="px-4 py-3 text-left font-medium w-16">重要度</th>
                    <th className="px-4 py-3 text-left font-medium w-14">访问</th>
                    <th className="px-4 py-3 text-left font-medium w-32">创建时间</th>
                    <th className="px-4 py-3 text-left font-medium w-16">状态</th>
                    <th className="px-4 py-3 text-left font-medium w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {memories.filter(m => !memorySearch || m.content.includes(memorySearch)).map(m => {
                    const importancePct = Math.round((m.importance || 0) * 100);
                    return (
                    <tr key={m.id} className="border-t transition-colors hover:bg-black/5" style={{ borderColor }}>
                      <td className="px-4 py-3.5 max-w-[300px]" style={{ color: textColor }}>
                        <div className="truncate" title={m.content}>{m.content}</div>
                      </td>
                      <td className="px-4 py-3.5" style={{ color: textSecondary }}>
                        {m.topic ? (
                          <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor, color: textSecondary }}>{m.topic}</span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3.5" style={{ color: textSecondary }}>
                        {m.importance > 0 ? (
                          <span className={cn("text-xs font-medium", importancePct >= 50 ? 'text-amber-500' : 'text-gray-400')}>
                            {importancePct}%
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3.5" style={{ color: textSecondary }}>
                        {m.access_count || 0}
                      </td>
                      <td className="px-4 py-3.5" style={{ color: textSecondary }}>
                        {new Date(m.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full",
                          m.status === 'invalidated' ? 'text-red-500 bg-red-50' : 'text-green-500 bg-green-50')}>
                          {m.status === 'invalidated' ? '已失效' : '活跃'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditingMemory(m)}
                            className="p-1 rounded transition-colors hover:bg-black/10" title="编辑"
                            style={{ color: textSecondary }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleViewMemorySources(m.id)}
                            className="p-1 rounded transition-colors hover:bg-black/10" title="查看来源"
                            style={{ color: primaryColor }}>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteMemoryId(m.id)}
                            className="p-1 rounded transition-colors hover:bg-red-50" title="删除"
                            style={{ color: '#ef4444' }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {memories.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center" style={{ color: textSecondary }}>
                        暂无记忆，开启全局记忆后系统会自动从对话中提取
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== 个人信息 Tab ===== */}
      {activeTab === 'profile' && (
        <div className="flex flex-col h-full w-full overflow-hidden p-4 gap-4">
          <div className="rounded-xl border p-4 flex items-center justify-between shrink-0"
            style={{ backgroundColor: 'var(--color-background)', borderColor }}>
            <div>
              <div className="text-lg font-bold" style={{ color: textColor }}>个人信息</div>
              <div className="text-xs mt-1" style={{ color: textSecondary }}>
                设置您的个人背景信息，AI 在回复时会参考这些信息
              </div>
            </div>
            <button
              onClick={() => { setShowAddProfile(true); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80 text-white"
              style={{ backgroundColor: primaryColor }}>
              <Plus className="w-4 h-4" /> 添加
            </button>
          </div>

          <div className="flex-1 rounded-xl border flex flex-col overflow-hidden"
            style={{ backgroundColor: 'var(--color-background)', borderColor }}>
            <div className="p-4 border-b" style={{ borderColor }}>
              <div className="text-sm font-medium" style={{ color: textColor }}>
                信息条目 ({profileEntries.length})
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: bgMute }}>
                  <tr style={{ color: textSecondary }}>
                    <th className="px-4 py-3 text-left font-medium w-36">键</th>
                    <th className="px-4 py-3 text-left font-medium">值</th>
                    <th className="px-4 py-3 text-left font-medium w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {profileEntries.map(entry => (
                    <tr key={entry.key} className="border-t transition-colors hover:bg-black/5" style={{ borderColor }}>
                      <td className="px-4 py-3.5 font-medium" style={{ color: textColor }}>{entry.key}</td>
                      <td className="px-4 py-3.5" style={{ color: textSecondary }}>{entry.value}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditingProfile(entry)}
                            className="p-1 rounded transition-colors hover:bg-black/10" title="编辑"
                            style={{ color: textSecondary }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteProfile(entry.key)}
                            className="p-1 rounded transition-colors hover:bg-red-50" title="删除"
                            style={{ color: '#ef4444' }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {profileEntries.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center" style={{ color: textSecondary }}>
                        暂无个人信息，点击"添加"按钮设置您的背景信息
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modals ===== */}
      {showAddProvider && (
        <AddProviderModal
          onClose={() => setShowAddProvider(false)}
          onSave={handleAddProvider}
        />
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
            for (const name of names) {
              await handleAddModel(name);
            }
            setShowFetchModels(false);
            setFetchedModels(null);
          }}
        />
      )}

      {showMemorySettings && memorySettings && (
        <MemorySettingsModal
          settings={memorySettings}
          providers={providers}
          models={models}
          onClose={() => setShowMemorySettings(false)}
          onSave={handleUpdateMemorySettings}
        />
      )}

      {showTestConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-xl w-full max-w-md overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
            <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>模型健康检测</h3>
              <button onClick={() => setShowTestConfirm(false)} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 rounded-lg border" style={{ backgroundColor: '#fef3c7', borderColor: '#f59e0b' }}>
                <p className="text-sm font-medium" style={{ color: '#92400e' }}>健康检查需要发送请求，请谨慎使用。</p>
                <p className="text-sm mt-1" style={{ color: '#a16207' }}>按次收费的模型可能产生更多费用，请自行承担。</p>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text-2)' }}>
                将对当前列表中的 {providerModels.length} 个模型逐一发送测试请求，每次最多等待 15 秒。
              </p>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setShowTestConfirm(false)} className="px-4 py-2 rounded-lg text-sm border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
              <button onClick={handleConfirmTestModels}
                className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
                style={{ backgroundColor: '#12C175' }}>开始</button>
            </div>
          </div>
        </div>
      )}

      {/* 单个模型测试弹窗 */}
      {showSingleTest && selectedProvider && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-xl w-full max-w-md overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
            <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>模型连通性测试</h3>
              <button onClick={() => setShowSingleTest(false)} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {providerModels.length > 0 ? (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>选择模型</label>
                    <select value={singleTestModelId} onChange={e => setSingleTestModelId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
                      style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {providerModels.map(m => (
                        <option key={m.id} value={m.id}>{m.display_name || m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="p-3 rounded-lg border" style={{ backgroundColor: '#fef3c7', borderColor: '#f59e0b' }}>
                    <p className="text-sm font-medium" style={{ color: '#92400e' }}>测试需要发送真实请求，请谨慎使用。</p>
                    <p className="text-sm mt-1" style={{ color: '#a16207' }}>按次收费的模型可能产生费用，请自行承担。</p>
                  </div>
                  {singleTestResult && (
                    <div className="p-3 rounded-lg border" style={{
                      backgroundColor: singleTestResult.success ? '#f0fdf4' : '#fef2f2',
                      borderColor: singleTestResult.success ? '#86efac' : '#fecaca',
                    }}>
                      {singleTestResult.success ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-5 h-5" style={{ color: '#22c55e' }} />
                          <span className="text-sm font-medium" style={{ color: '#16a34a' }}>
                            连接成功 ({singleTestResult.time}ms)
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <XCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                          <div>
                            <span className="text-sm font-medium" style={{ color: '#dc2626' }}>连接失败</span>
                            {singleTestResult.error && (
                              <p className="text-xs mt-1" style={{ color: '#b91c1c' }}>{singleTestResult.error}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-2)' }}>暂无模型</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>请先通过"获取模型列表"或"+"按钮添加模型</p>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setShowSingleTest(false)} className="px-4 py-2 rounded-lg text-sm border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
              {providerModels.length > 0 && (
                <button onClick={handleConfirmSingleTest} disabled={singleTesting || !singleTestModelId}
                  className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#12C175' }}>
                  {singleTesting ? '测试中...' : '开始'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 删除供应商确认弹窗 */}
      {confirmDeleteId && selectedProvider && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
            <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>删除供应商</h3>
              <button onClick={() => setConfirmDeleteId(null)} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              <p className="text-sm" style={{ color: 'var(--color-text-2)' }}>
                确认删除供应商 <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{selectedProvider.name}</span>？
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-3)' }}>
                该供应商下的所有模型也将被删除，此操作不可撤销。
              </p>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-lg text-sm border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
              <button onClick={() => handleDeleteProvider(confirmDeleteId)}
                className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
                style={{ backgroundColor: '#ef4444' }}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑记忆弹窗 */}
      {editingMemory && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
            <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>编辑记忆</h3>
              <button onClick={() => setEditingMemory(null)} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>记忆内容</label>
                <textarea
                  defaultValue={editingMemory.content}
                  id="edit-memory-content"
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none resize-none"
                  style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)', minHeight: '120px' }}
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setEditingMemory(null)} className="px-4 py-2 rounded-lg text-sm border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
              <button onClick={() => {
                const textarea = document.getElementById('edit-memory-content') as HTMLTextAreaElement;
                if (textarea?.value.trim()) handleUpdateMemory(editingMemory.id, textarea.value.trim());
              }}
                className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
                style={{ backgroundColor: primaryColor }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 查看记忆来源弹窗 */}
      {viewingMemoryId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--color-background)' }}>
            <div className="px-5 py-4 border-b flex justify-between items-center shrink-0" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>记忆来源追溯</h3>
              <button onClick={() => { setViewingMemoryId(null); setMemoryDetail(null); }} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {loadingMemoryDetail ? (
                <div className="flex items-center justify-center py-12 gap-2" style={{ color: 'var(--color-text-3)' }}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">加载来源信息...</span>
                </div>
              ) : memoryDetail ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium mb-2" style={{ color: 'var(--color-text-2)' }}>记忆内容</div>
                    <div className="p-3 rounded-lg border text-sm" style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {memoryDetail.content}
                    </div>
                  </div>
                  {memoryDetail.topic && (
                    <div>
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text-2)' }}>主题: </span>
                      <span className="text-sm" style={{ color: 'var(--color-text)' }}>{memoryDetail.topic}</span>
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-medium mb-2" style={{ color: 'var(--color-text-2)' }}>关联的 Chunk</div>
                    {memoryDetail.sources && memoryDetail.sources.length > 0 ? (
                      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                        <table className="w-full text-sm">
                          <thead style={{ backgroundColor: 'var(--color-background-soft)' }}>
                            <tr style={{ color: 'var(--color-text-2)' }}>
                              <th className="px-3 py-2.5 text-left font-medium">来源类型</th>
                              <th className="px-3 py-2.5 text-left font-medium">Chunk ID</th>
                              <th className="px-3 py-2.5 text-left font-medium">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {memoryDetail.sources.map((s: any, i: number) => (
                              <tr key={i} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                                <td className="px-3 py-2.5" style={{ color: 'var(--color-text-2)' }}>
                                  {s.source_type === 'chunk' ? '对话分段' : s.source_type === 'message' ? '消息' : s.source_type === 'attachment' ? '附件' : s.source_type === 'web_retrieval' ? '网页检索' : s.source_type}
                                </td>
                                <td className="px-3 py-2.5 font-mono text-xs" style={{ color: primaryColor }}>{s.chunk_id || '-'}</td>
                                <td className="px-3 py-2.5">
                                  {s.conversation_id ? (
                                    <button
                                      onClick={() => window.dispatchEvent(new CustomEvent('navigate-conversation', { detail: { conversationId: s.conversation_id } }))}
                                      className="text-xs px-2 py-1 rounded border transition-colors hover:bg-black/5"
                                      style={{ borderColor: primaryColor, color: primaryColor }}
                                      title="跳转到原始对话">
                                      <ExternalLink className="w-3 h-3 inline mr-1" />跳转
                                    </button>
                                  ) : (
                                    <span className="text-xs" style={{ color: 'var(--color-text-3)' }}>无法跳转</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-sm py-4 text-center" style={{ color: 'var(--color-text-3)' }}>暂无来源信息</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm py-8 text-center" style={{ color: 'var(--color-text-3)' }}>加载失败</div>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end shrink-0" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => { setViewingMemoryId(null); setMemoryDetail(null); }}
                className="px-4 py-2 rounded-lg text-sm border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除记忆确认弹窗 */}
      {confirmDeleteMemoryId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
            <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>删除记忆</h3>
              <button onClick={() => setConfirmDeleteMemoryId(null)} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              <p className="text-sm" style={{ color: 'var(--color-text-2)' }}>确认删除这条记忆？此操作不可撤销。</p>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setConfirmDeleteMemoryId(null)} className="px-4 py-2 rounded-lg text-sm border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
              <button onClick={() => handleDeleteMemory(confirmDeleteMemoryId)}
                className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
                style={{ backgroundColor: '#ef4444' }}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 添加/编辑个人信息弹窗 */}
      {(showAddProfile || editingProfile) && (
        <ProfileEditModal
          initialKey={editingProfile?.key || ''}
          initialValue={editingProfile?.value || ''}
          isEdit={!!editingProfile}
          onClose={() => { setShowAddProfile(false); setEditingProfile(null); }}
          onSave={(key, value) => {
            if (editingProfile) {
              handleUpdateProfile(key, value);
            } else {
              handleAddProfile(key, value);
            }
          }}
        />
      )}
    </div>
  );
}

// ===== Add Provider Modal =====
function AddProviderModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, type: string, baseUrl: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('OpenAI');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onSave(name.trim(), type, '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>添加提供商</h3>
          <button onClick={onClose} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-2)' }}>名称</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
              placeholder="例如 通义千问" />
          </div>
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-2)' }}>类型</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="OpenAI">OpenAI</option>
              <option value="Ollama">Ollama</option>
              <option value="Custom">自定义</option>
            </select>
          </div>
          {error && (
            <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>
          )}
          <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>
            添加后可在右侧面板配置 API 地址和密钥
          </p>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
          <button onClick={handleSave} disabled={loading || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors"
            style={{ backgroundColor: 'var(--color-primary)', opacity: loading || !name.trim() ? 0.5 : 1 }}>
            {loading ? '添加中...' : '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Add Model Modal =====
function AddModelModal({ onClose, onSave, onValidate }: {
  onClose: () => void;
  onSave: (name: string) => void;
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
      if (result.valid) {
        onSave(name.trim());
      } else {
        setError(result.error || '模型验证失败，请确认模型名称是否正确');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证请求失败');
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>添加模型</h3>
          <button onClick={onClose} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-2)' }}>模型标识 (Model ID)</label>
          <input value={name} onChange={e => { setName(e.target.value); setError(''); }} autoFocus
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
            style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            placeholder="例如 gpt-4o"
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }} />
          {error && (
            <p className="text-xs mt-2" style={{ color: '#ef4444' }}>{error}</p>
          )}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
          <button onClick={handleConfirm} disabled={validating || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {validating ? '验证中...' : '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Fetch Models Modal =====
function FetchModelsModal({
  providerName,
  models,
  existingModelNames,
  loading,
  error,
  onClose,
  onAddModel,
  onAddSelected,
}: {
  providerName: string;
  models: any;
  existingModelNames: string[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onAddModel: (name: string) => void;
  onAddSelected: (names: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  // 从模型 ID 提取厂商前缀分组
  // "MiniMax/MiniMax-M2.7" → "MiniMax"  (有 / 则取 / 前部分)
  // "MiniMax-M2.5"        → "MiniMax"  (无 / 则取前导字母)
  // "qwen3.6-flash"       → "qwen"
  const extractGroup = (id: string): string => {
    const slashIdx = id.indexOf('/');
    if (slashIdx !== -1) return id.slice(0, slashIdx);
    const match = id.match(/^[A-Za-z]+/);
    return match ? match[0] : '其他';
  };

  // Parse models into groups
  const groups: Record<string, any[]> = {};
  if (models?.data) {
    for (const model of models.data) {
      const group = extractGroup(model.id || model.name || '');
      if (!groups[group]) groups[group] = [];
      groups[group].push(model);
    }
  }

  const allModels = models?.data || [];
  // 按模型数量降序排列分组
  const categories = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);

  const filteredModels = allModels.filter((m: any) => {
    if (!searchText) return true;
    return (m.id || m.name || '').toLowerCase().includes(searchText.toLowerCase());
  });

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
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const allIds = new Set<string>();
    for (const models of Object.values(filteredGroups)) {
      for (const m of models) {
        allIds.add(m.id || m.name);
      }
    }
    setSelectedIds(allIds);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const isSelected = (id: string) => selectedIds.has(id);
  const isExisting = (id: string) => existingModelNames.includes(id);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--color-background)', height: '800px' }}>
        {/* Header */}
        <div className="px-5 py-4 border-b flex justify-between items-center shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{providerName}模型</h3>
          <button onClick={onClose} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
        </div>

        {/* Search & Category Tabs */}
        <div className="px-5 py-3 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4" style={{ color: 'var(--color-text-3)' }} />
              <input
                placeholder="搜索模型 ID 或名称"
                className="w-full pl-10 pr-3 py-2 rounded-lg border text-sm outline-none"
                style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1">
              <button onClick={selectAll}
                className="px-2 py-1 rounded text-xs border transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>
                全选
              </button>
              <button onClick={deselectAll}
                className="px-2 py-1 rounded text-xs border transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>
                取消
              </button>
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setActiveCategory('all')}
              className={cn("px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                activeCategory === 'all' ? 'text-white' : 'border')}
              style={{
                backgroundColor: activeCategory === 'all' ? 'var(--color-primary)' : 'transparent',
                borderColor: activeCategory === 'all' ? 'var(--color-primary)' : 'var(--color-border)',
                color: activeCategory === 'all' ? 'white' : 'var(--color-text-2)',
              }}>
              全部
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn("px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                  activeCategory === cat ? 'text-white' : 'border')}
                style={{
                  backgroundColor: activeCategory === cat ? 'var(--color-primary)' : 'transparent',
                  borderColor: activeCategory === cat ? 'var(--color-primary)' : 'var(--color-border)',
                  color: activeCategory === cat ? 'white' : 'var(--color-text-2)',
                }}>
{cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-primary)' }} />
              <span className="text-sm" style={{ color: 'var(--color-text-3)' }}>正在获取模型列表...</span>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: '#ef4444' }}>获取失败</p>
              <p className="text-xs" style={{ color: 'var(--color-text-3)' }}>{error}</p>
            </div>
          ) : models && Object.entries(filteredGroups).length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-3)' }}>
              未找到匹配的模型
            </div>
          ) : models ? (
            Object.entries(filteredGroups).map(([category, catModels]) => (
              <div key={category} className="mb-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-2)' }}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-background-soft)', color: 'var(--color-text-3)' }}>
                    {catModels.length}
                  </span>
                  <ChevronRight className="w-3 h-3" style={{ color: 'var(--color-text-3)' }} />
                </div>
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  {catModels.map((model: any) => {
                    const modelId = model.id || model.name;
                    const selected = isSelected(modelId);
                    const exists = isExisting(modelId);
                    return (
                      <div key={modelId}
                        className={cn("flex items-center justify-between px-4 py-2.5 border-b last:border-0 transition-colors",
                          selected && 'bg-primary-mute')}
                        style={{ borderColor: 'var(--color-border)', backgroundColor: selected ? 'var(--color-primary-mute)' : 'transparent' }}>
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Checkbox */}
                          <button onClick={() => toggleSelect(modelId)}
                            className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                              selected ? 'border-primary bg-primary' : 'border-gray-300')}
                            style={{
                              borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                              backgroundColor: selected ? 'var(--color-primary)' : 'transparent',
                            }}>
                            {selected && <span className="text-white text-[10px]">✓</span>}
                          </button>
                          <span className="text-sm font-medium truncate" style={{ color: exists ? 'var(--color-text-3)' : 'var(--color-text)' }}>
                            {modelId}
                          </span>
                          {exists && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border shrink-0" style={{ color: 'var(--color-text-3)', borderColor: 'var(--color-border)' }}>
                              已添加
                            </span>
                          )}
                        </div>
                        <button onClick={() => { if (!exists) onAddModel(modelId); }}
                          className={cn("p-1 rounded transition-colors shrink-0",
                            exists ? 'opacity-30 cursor-not-allowed' : 'hover:opacity-80')}
                          style={{ color: 'var(--color-primary)' }}>
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

        {/* Footer */}
        <div className="px-5 py-4 border-t flex justify-between items-center shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-xs" style={{ color: 'var(--color-text-3)' }}>
            已选择 {selectedIds.size} 个模型
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
            <button onClick={() => onAddSelected(Array.from(selectedIds))}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              添加选中的模型
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Memory Settings Modal =====
function MemorySettingsModal({ settings, providers, models, onClose, onSave }: {
  settings: MemorySettings;
  providers: Provider[];
  models: Model[];
  onClose: () => void;
  onSave: (updates: Partial<MemorySettings>) => void;
}) {
  const [llmProviderId, setLlmProviderId] = useState(settings.llm_provider_id || '');
  const [llmModelId, setLlmModelId] = useState(settings.llm_model_id || '');
  const [embProviderId, setEmbProviderId] = useState(settings.embedding_provider_id || '');
  const [embModelId, setEmbModelId] = useState(settings.embedding_model_id || '');
  const [embDim, setEmbDim] = useState(settings.embedding_dimension || 1536);

  const llmModels = models.filter(m => m.provider_id === llmProviderId);
  const embModels = models.filter(m => m.provider_id === embProviderId);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>记忆设置</h3>
          <button onClick={onClose} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>LLM 模型 (记忆提取)</label>
            <select value={llmProviderId} onChange={e => { setLlmProviderId(e.target.value); setLlmModelId(''); }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none mb-2"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">选择提供商</option>
              {providers.filter(p => p.enabled).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={llmModelId} onChange={e => setLlmModelId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">选择模型</option>
              {llmModels.map(m => (
                <option key={m.id} value={m.id}>{m.display_name || m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>嵌入模型</label>
            <select value={embProviderId} onChange={e => { setEmbProviderId(e.target.value); setEmbModelId(''); }}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none mb-2"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">选择提供商</option>
              {providers.filter(p => p.enabled).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={embModelId} onChange={e => setEmbModelId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">选择模型</option>
              {embModels.map(m => (
                <option key={m.id} value={m.id}>{m.display_name || m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>嵌入维度</label>
            <input type="number" value={embDim} onChange={e => setEmbDim(parseInt(e.target.value) || 1536)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
          <button onClick={() => onSave({
            llm_provider_id: llmProviderId || null,
            llm_model_id: llmModelId || null,
            embedding_provider_id: embProviderId || null,
            embedding_model_id: embModelId || null,
            embedding_dimension: embDim,
          })} className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}>保存</button>
        </div>
      </div>
    </div>
  );
}


// ===== 个人信息编辑弹窗 =====
function ProfileEditModal({ initialKey, initialValue, isEdit, onClose, onSave }: {
  initialKey: string;
  initialValue: string;
  isEdit: boolean;
  onClose: () => void;
  onSave: (key: string, value: string) => void;
}) {
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!key.trim()) { setError('键不能为空'); return; }
    if (!value.trim()) { setError('值不能为空'); return; }
    onSave(key.trim(), value.trim());
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-md overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{isEdit ? '编辑信息' : '添加信息'}</h3>
          <button onClick={onClose} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>键（字段名）</label>
            <input
              value={key}
              onChange={e => { setKey(e.target.value); setError(''); }}
              disabled={isEdit}
              autoFocus={!isEdit}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              placeholder="例如: 昵称、位置、职业、技术栈"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>值</label>
            <textarea
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); }}
              autoFocus={isEdit}
              className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none resize-none"
              style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)', minHeight: '80px' }}
              placeholder="例如: 张三 (填写详细信息)"
            />
          </div>
          {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
          <button onClick={handleSave}
            className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}>保存</button>
        </div>
      </div>
    </div>
  );
}
