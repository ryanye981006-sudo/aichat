import { useState, useEffect } from 'react';
import type { Provider, Model, KnowledgeBase, KnowledgeDocument, MemorySettings, MemoryEntry } from '../types';
import { cn } from '../lib/utils';
import { providersApi, modelsApi, knowledgeApi, memoryApi } from '../services/api';
import { Search, Plus, Eye, EyeOff, Minus, Settings, Database, Brain, Box, Trash2, Upload, X, ChevronRight, FileText, RefreshCw } from 'lucide-react';

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

interface SettingsAreaProps {
  activeTab: 'model' | 'rag' | 'memory';
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
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fetchedModels, setFetchedModels] = useState<any>(null);

  // ===== RAG 状态 =====
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [kbSearch, setKbSearch] = useState('');
  const [showAddKb, setShowAddKb] = useState(false);

  // ===== 记忆状态 =====
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memorySearch, setMemorySearch] = useState('');
  const [showMemorySettings, setShowMemorySettings] = useState(false);

  // 加载数据
  useEffect(() => {
    loadProviders();
    loadKnowledgeBases();
    loadMemoryData();
    // 清除名为"1"的供应商下的所有模型
    clearProviderOneModels();
  }, []);

  const clearProviderOneModels = async () => {
    try {
      const ps = await providersApi.list();
      const provider1 = ps.find(p => p.name === '1');
      if (provider1) {
        await providersApi.clearModels(provider1.id);
        loadProviders(); // 重新加载
      }
    } catch (e) { console.error(e); }
  };

  const loadProviders = async () => {
    try {
      const [p, m] = await Promise.all([providersApi.list(), modelsApi.list()]);
      setProviders(p);
      setModels(m);
      if (!selectedProviderId && p.length > 0) setSelectedProviderId(p[0].id);
    } catch (e) { console.error('加载提供商失败:', e); }
  };

  const loadKnowledgeBases = async () => {
    try {
      const kbs = await knowledgeApi.list();
      setKnowledgeBases(kbs);
    } catch (e) { console.error('加载知识库失败:', e); }
  };

  const loadDocuments = async (kbId: string) => {
    try {
      const docs = await knowledgeApi.getDocuments(kbId);
      setDocuments(docs);
    } catch (e) { console.error('加载文档失败:', e); }
  };

  const loadMemoryData = async () => {
    try {
      const [settings, mems] = await Promise.all([memoryApi.getSettings(), memoryApi.list()]);
      setMemorySettings(settings);
      setMemories(mems);
    } catch (e) { console.error('加载记忆失败:', e); }
  };

  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const filteredProviders = providers.filter(p => p.name.toLowerCase().includes(providerSearch.toLowerCase()));
  const providerModels = models.filter(m => m.provider_id === selectedProviderId);

  const handleAddProvider = async (name: string, type: string, baseUrl: string): Promise<void> => {
    const p = await providersApi.create({ name, type, base_url: baseUrl });
    setProviders(prev => [...prev, p]);
    setSelectedProviderId(p.id);
    setShowAddProvider(false);
  };

  const handleUpdateProvider = async (id: string, updates: Partial<Provider>) => {
    try {
      const p = await providersApi.update(id, updates);
      setProviders(prev => prev.map(x => x.id === id ? p : x));
    } catch (e) { console.error(e); }
  };

  const handleAddModel = async (name: string) => {
    if (!selectedProviderId) return;
    try {
      const m = await modelsApi.create({ provider_id: selectedProviderId, name, display_name: name });
      setModels(prev => [...prev, m]);
    } catch (e) { console.error(e); }
  };

  const handleTestProvider = async () => {
    if (!selectedProviderId) return;
    setTesting(true);
    setTestResult(null);
    try {
      await providersApi.test(selectedProviderId);
      setTestResult({ success: true, message: '连接成功' });
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    if (!selectedProviderId) return;
    setFetching(true);
    try {
      const data = await providersApi.fetchModels(selectedProviderId);
      setFetchedModels(data);
      setShowFetchModels(true);
    } catch (e) {
      console.error(e);
    } finally {
      setFetching(false);
    }
  };

  const handleClearModels = async () => {
    if (!selectedProviderId) return;
    try {
      await providersApi.clearModels(selectedProviderId);
      setModels(prev => prev.filter(m => m.provider_id !== selectedProviderId));
    } catch (e) { console.error(e); }
  };

  const handleRemoveModel = async (modelId: string) => {
    try {
      await modelsApi.remove(modelId);
      setModels(prev => prev.filter(m => m.id !== modelId));
    } catch (e) { console.error(e); }
  };


  const handleCreateKb = async (name: string) => {
    try {
      const kb = await knowledgeApi.create({ name });
      setKnowledgeBases(prev => [...prev, kb]);
      setShowAddKb(false);
    } catch (e) { console.error(e); }
  };

  const handleUploadDocument = async (kbId: string, file: File) => {
    try {
      await knowledgeApi.uploadDocument(kbId, file);
      await loadDocuments(kbId);
    } catch (e) { console.error(e); }
  };

  const handleUpdateMemorySettings = async (updates: Partial<MemorySettings>) => {
    try {
      const s = await memoryApi.updateSettings(updates);
      setMemorySettings(s);
      setShowMemorySettings(false);
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
          </div>

          {/* Right: Config */}
          {selectedProvider ? (
            <div className="flex-1 overflow-y-auto">
              <div className="px-8 py-6 w-full">
                <div className="flex items-center gap-2 mb-6 pb-4 border-b" style={{ borderColor }}>
                  <h2 className="text-lg font-bold" style={{ color: textColor }}>{selectedProvider.name}</h2>
                  <div className="flex-1" />
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
                      <button onClick={handleTestProvider} disabled={testing}
                        className="px-4 border-l text-sm font-medium transition-colors hover:opacity-80 disabled:opacity-50"
                        style={{ borderColor, color: testResult ? (testResult.success ? '#22c55e' : '#ef4444') : textSecondary }}>
                        {testing ? '测试中...' : testResult ? (testResult.success ? '✓ 成功' : '✗ 失败') : '测试'}
                      </button>
                    </div>
                    {testResult && (
                      <p className="text-xs mt-1" style={{ color: testResult.success ? '#22c55e' : '#ef4444' }}>
                        {testResult.message}
                      </p>
                    )}
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
                  </div>

                  {/* Models */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center gap-2 text-sm font-bold" style={{ color: textColor }}>
                        模型
                        <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: bgMute, color: textSecondary }}>
                          {providerModels.length}
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <button onClick={handleClearModels}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
                          style={{ borderColor: '#ef4444', color: '#ef4444' }}>
                          <Trash2 className="w-3.5 h-3.5" /> 清空
                        </button>
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
                    <div className="rounded-xl border overflow-hidden mb-3" style={{ borderColor }}>
                      {providerModels.map(m => (
                        <div key={m.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0 transition-colors"
                          style={{ borderColor }}>
                          <div className="flex items-center gap-3">
                            <Box className="w-4 h-4" style={{ color: textSecondary }} />
                            <span className="text-sm font-medium" style={{ color: textColor }}>{m.display_name || m.name}</span>
                          </div>
                          <button onClick={() => handleRemoveModel(m.id)}
                            className="p-1 rounded transition-colors hover:bg-red-50" style={{ color: textSecondary }}>
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
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

      {/* ===== RAG 知识库 Tab ===== */}
      {activeTab === 'rag' && (
        <div className="flex h-full w-full overflow-hidden">
          {/* Left: KB List */}
          <div className="w-[240px] flex flex-col border-r shrink-0" style={{ borderColor, backgroundColor: bgMute }}>
            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5" style={{ color: textSecondary }} />
                <input
                  placeholder="搜索知识库..."
                  className="w-full pl-9 pr-3 py-2 bg-transparent rounded-lg text-sm outline-none"
                  style={{ color: textColor }}
                  value={kbSearch}
                  onChange={e => setKbSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {knowledgeBases.filter(k => k.name.includes(kbSearch)).map(kb => (
                <button
                  key={kb.id}
                  onClick={() => { setSelectedKbId(kb.id); loadDocuments(kb.id); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors"
                  style={{
                    backgroundColor: selectedKbId === kb.id ? 'var(--color-primary-mute)' : 'transparent',
                    color: selectedKbId === kb.id ? primaryColor : textColor,
                  }}
                >
                  <Database className="w-4 h-4" style={{ opacity: 0.6 }} />
                  <span className="truncate">{kb.name}</span>
                </button>
              ))}
            </div>
            <div className="p-3 border-t" style={{ borderColor }}>
              <button onClick={() => setShowAddKb(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium border transition-colors hover:opacity-80"
                style={{ borderColor, color: textColor }}>
                <Plus className="w-4 h-4" /> 新建知识库
              </button>
            </div>
          </div>

          {/* Right: Documents */}
          <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-background)' }}>
            {selectedKbId ? (
              <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <label className="relative cursor-pointer">
                    <input type="file" className="hidden" accept=".pdf,.docx,.txt,.md" onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadDocument(selectedKbId, file);
                    }} />
                    <span className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
                      style={{ backgroundColor: primaryColor }}>
                      <Upload className="w-4 h-4" /> 上传文件
                    </span>
                  </label>
                  <span className="text-xs" style={{ color: textSecondary }}>
                    支持 PDF、Word、Markdown、TXT 格式
                  </span>
                </div>

                <div className="rounded-xl border overflow-hidden" style={{ borderColor }}>
                  <table className="w-full text-sm">
                    <thead style={{ backgroundColor: bgMute }}>
                      <tr style={{ color: textSecondary }}>
                        <th className="px-4 py-3 text-left font-medium">文件名称</th>
                        <th className="px-4 py-3 text-left font-medium w-20">状态</th>
                        <th className="px-4 py-3 text-left font-medium w-16">分块</th>
                        <th className="px-4 py-3 text-left font-medium w-36">上传时间</th>
                        <th className="px-4 py-3 text-left font-medium w-20">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map(doc => (
                        <tr key={doc.id} className="border-t transition-colors hover:bg-black/5" style={{ borderColor }}>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4" style={{ color: textSecondary }} />
                              <span style={{ color: textColor }}>{doc.file_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={cn("text-xs px-2 py-0.5 rounded-full", doc.processing_status === 'completed' ? 'text-green-600 bg-green-50' : doc.processing_status === 'error' ? 'text-red-600 bg-red-50' : 'text-yellow-600 bg-yellow-50')}>
                              {doc.processing_status === 'completed' ? '已完成' : doc.processing_status === 'error' ? '失败' : '处理中'}
                            </span>
                          </td>
                          <td className="px-4 py-3.5" style={{ color: textSecondary }}>{doc.chunk_count}</td>
                          <td className="px-4 py-3.5" style={{ color: textSecondary }}>{new Date(doc.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-3.5">
                            <button className="text-red-500 hover:text-red-600 text-xs font-medium">删除</button>
                          </td>
                        </tr>
                      ))}
                      {documents.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center" style={{ color: textSecondary }}>
                            暂无文档，请上传文件
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center" style={{ color: textSecondary }}>
                请选择左侧知识库
              </div>
            )}
          </div>
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
                    <th className="px-4 py-3 text-left font-medium w-36">创建时间</th>
                    <th className="px-4 py-3 text-left font-medium w-20">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {memories.filter(m => !memorySearch || m.content.includes(memorySearch)).map(m => (
                    <tr key={m.id} className="border-t" style={{ borderColor }}>
                      <td className="px-4 py-3.5" style={{ color: textColor }}>{m.content}</td>
                      <td className="px-4 py-3.5" style={{ color: textSecondary }}>
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full",
                          m.is_deleted ? 'text-red-500 bg-red-50' : 'text-green-500 bg-green-50')}>
                          {m.is_deleted ? '已删除' : '活跃'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {memories.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center" style={{ color: textSecondary }}>
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

      {/* ===== Modals ===== */}
      {showAddProvider && (
        <AddProviderModal
          onClose={() => setShowAddProvider(false)}
          onSave={handleAddProvider}
        />
      )}

      {showAddModel && (
        <AddModelModal
          onClose={() => setShowAddModel(false)}
          onSave={handleAddModel}
        />
      )}

      {showFetchModels && selectedProvider && fetchedModels && (
        <FetchModelsModal
          providerName={selectedProvider.name}
          models={fetchedModels}
          existingModelNames={providerModels.map(m => m.name)}
          onClose={() => { setShowFetchModels(false); setFetchedModels(null); }}
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

      {showAddKb && (
        <AddKbModal
          onClose={() => setShowAddKb(false)}
          onSave={handleCreateKb}
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
function AddModelModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>添加模型</h3>
          <button onClick={onClose} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-2)' }}>模型标识 (Model ID)</label>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
            style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            placeholder="例如 gpt-4o" />
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
          <button onClick={() => { if (name.trim()) onSave(name.trim()); }}
            className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}>确定</button>
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
  onClose,
  onAddModel,
  onAddSelected,
}: {
  providerName: string;
  models: any;
  existingModelNames: string[];
  onClose: () => void;
  onAddModel: (name: string) => void;
  onAddSelected: (names: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  // Parse models into groups
  const groups: Record<string, any[]> = {};
  if (models.data) {
    for (const model of models.data) {
      const category = model.category || model.category_name || '其他';
      if (!groups[category]) groups[category] = [];
      groups[category].push(model);
    }
  }

  const allModels = models.data || [];
  const categories = Object.keys(groups);

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

  const categoryLabels: Record<string, string> = {
    'all': '全部',
    '推理': '推理',
    '视觉': '视觉',
    '联网': '联网',
    '免费': '免费',
    '嵌入': '嵌入',
    '重排': '重排',
    '工具': '工具',
    '其他': '其他',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--color-background)', maxHeight: '85vh' }}>
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
          <div className="flex gap-1 overflow-x-auto">
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
            {categories.filter(c => c !== '其他').map(cat => (
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
                {categoryLabels[cat] || cat}
              </button>
            ))}
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {Object.entries(filteredGroups).length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-3)' }}>
              未找到匹配的模型
            </div>
          ) : (
            Object.entries(filteredGroups).map(([category, catModels]) => (
              <div key={category} className="mb-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-2)' }}>
                    {categoryLabels[category] || category}
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
          )}
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

// ===== Add KB Modal =====
function AddKbModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>新建知识库</h3>
          <button onClick={onClose} style={{ color: 'var(--color-text-3)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <label className="block text-sm mb-1.5" style={{ color: 'var(--color-text-2)' }}>知识库名称</label>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
            style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            placeholder="例如 技术文档库" />
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}>取消</button>
          <button onClick={() => { if (name.trim()) onSave(name.trim()); }}
            className="px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}>确定</button>
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
