// 知识库设置页：文档列表 + 搜索测试（双 Tab）+ 底部模型信息
import { useState, useEffect, useRef, useCallback } from 'react';
import { toolsApi, knowledgeApi } from '../../services/api';
import { BtnPrimary } from '../shared/Primitives';
import { Upload, Trash2, Search, FileText, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

type TabKey = 'documents' | 'search';

// 文档状态映射
const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: '等待处理', icon: <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--muted-soft)' }} />, color: 'var(--muted-soft)' },
  loading: { label: '加载中', icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'var(--accent)' },
  chunking: { label: '分词中', icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'var(--accent)' },
  embedding: { label: '向量化中', icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'var(--accent)' },
  completed: { label: '已完成', icon: <CheckCircle className="w-3 h-3" style={{ color: 'var(--success)' }} />, color: 'var(--success)' },
  error: { label: '处理失败', icon: <XCircle className="w-3 h-3" style={{ color: 'var(--danger)' }} />, color: 'var(--danger)' },
};

export default function KnowledgeSettings() {
  const [tab, setTab] = useState<TabKey>('documents');

  // 嵌入/重排序模型信息（只读）
  const [embModelName, setEmbModelName] = useState('');
  const [rerankModelName, setRerankModelName] = useState('');

  // 文档列表
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 上传
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 搜索测试
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchError, setSearchError] = useState('');

  // 加载模型配置和文档列表
  const loadConfigs = useCallback(async () => {
    try {
      const [emb, rerank] = await Promise.all([
        toolsApi.getEmbeddingConfig(),
        toolsApi.getRerankerConfig(),
      ]);
      if (emb?.modelName) setEmbModelName(emb.modelName);
      if (rerank?.modelName) setRerankModelName(rerank.modelName);
    } catch { /* ignore */ }
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await knowledgeApi.listDocuments();
      setDocuments(docs);
      const hasProcessing = docs.some((d: any) => !['completed', 'error'].includes(d.processing_status));
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      if (hasProcessing) {
        pollTimerRef.current = setInterval(loadDocuments, 3000);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConfigs();
    loadDocuments();
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [loadConfigs, loadDocuments]);

  // 上传文件
  const handleUpload = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const res = await knowledgeApi.uploadDocuments(fileArr);
      const errors = res.results.filter((r: any) => r.error);
      if (errors.length > 0) {
        setUploadError(errors.map((e: any) => `${e.fileName}: ${e.error}`).join('；'));
      }
      await loadDocuments();
    } catch (err: any) {
      setUploadError(err.message || '上传失败');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  };

  const handleDelete = async (id: string) => {
    try {
      await knowledgeApi.deleteDocument(id);
      await loadDocuments();
    } catch { /* ignore */ }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setSearchResults(null);
    try {
      const res = await knowledgeApi.search(q);
      setSearchResults(res.results || []);
    } catch (err: any) {
      setSearchError(err.message || '搜索失败');
    }
    setSearching(false);
  };

  const hasProcessing = documents.some((d: any) => !['completed', 'error'].includes(d.processing_status));
  const completedCount = documents.filter((d: any) => d.processing_status === 'completed').length;

  return (
    <div className="w-full py-6 px-6 flex flex-col" style={{ minHeight: '100%' }}>
      {/* Tab 切换栏 */}
      <div className="flex items-center gap-0 mb-6" style={{ borderBottom: '1px solid var(--border)' }}>
        {([
          ['documents', '文档列表'],
          ['search', '搜索测试'],
        ] as [TabKey, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="relative px-5 py-2.5 transition-colors"
            style={{
              fontSize: 13,
              fontWeight: tab === key ? 600 : 500,
              fontFamily: 'var(--font-body)',
              color: tab === key ? 'var(--accent)' : 'var(--muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {label}
            {tab === key && (
              <span
                className="absolute bottom-0 left-5 right-5"
                style={{ height: 2, borderRadius: 1, backgroundColor: 'var(--accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容区 */}
      <div className="flex-1">
        {tab === 'documents' && (
          <>
            {/* 上传区域 */}
            <div className="setting-group-label" style={{ marginBottom: 4 }}>上传文档</div>
            <p style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)', marginBottom: 8 }}>
              支持 PDF、Word、TXT、Markdown 格式
            </p>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors cursor-pointer py-8 gap-2"
              style={{
                borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
                backgroundColor: dragOver ? 'var(--accent-dim)' : 'transparent',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-6 h-6" style={{ color: dragOver ? 'var(--accent)' : 'var(--muted-soft)' }} />
              <span style={{ fontSize: 13, color: dragOver ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--font-body)' }}>
                {dragOver ? '释放文件上传' : '拖拽文件到此处，或点击选择文件'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>
                PDF / Word / TXT / Markdown，最大 50MB
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.markdown"
              className="hidden"
              onChange={e => e.target.files && handleUpload(e.target.files)}
            />
            {uploading && (
              <div className="flex items-center gap-2 mt-2" style={{ fontSize: 12, color: 'var(--accent)' }}>
                <Loader2 className="w-3 h-3 animate-spin" /> 上传中...
              </div>
            )}
            {uploadError && (
              <div className="flex items-start gap-1.5 mt-2" style={{ fontSize: 12, color: 'var(--danger)' }}>
                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* 文档列表 */}
            <div className="setting-group-label" style={{ marginTop: 28, marginBottom: 4 }}>文档列表（{documents.length}）</div>
            <p style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)', marginBottom: 8 }}>
              {hasProcessing ? '文档处理中，完成后即可搜索' : `已完成 ${completedCount} 个文档`}
            </p>
            {loading ? (
              <div className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--muted)' }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载中...
              </div>
            ) : documents.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>暂无文档</p>
            ) : (
              <div className="space-y-1">
                {documents.map((doc: any) => {
                  const status = STATUS_MAP[doc.processing_status] || { label: doc.processing_status, icon: null, color: 'var(--muted)' };
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
                      style={{ backgroundColor: 'var(--border-soft)' }}
                    >
                      <FileText className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--muted-soft)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', fontFamily: 'var(--font-body)' }}>
                            {doc.file_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="flex items-center gap-1" style={{ fontSize: 11, color: status.color, fontFamily: 'var(--font-body)' }}>
                            {status.icon} {status.label}
                          </span>
                          {doc.chunk_count > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>
                              · {doc.chunk_count} 个分块
                            </span>
                          )}
                          {doc.error_message && (
                            <span className="truncate" style={{ fontSize: 11, color: 'var(--danger)', fontFamily: 'var(--font-body)' }}>
                              · {doc.error_message}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                        className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--muted-soft)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--danger)'; (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(212,96,106,0.1)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-soft)'; (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === 'search' && (
          <>
            <div className="setting-group-label" style={{ marginBottom: 4 }}>搜索测试</div>
            <p style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)', marginBottom: 8 }}>
              输入查询内容，测试知识库搜索效果
            </p>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4" style={{ color: 'var(--muted-soft)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                  placeholder="输入搜索关键词..."
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border outline-none bg-transparent"
                  style={{
                    borderColor: 'var(--border)',
                    fontSize: 13,
                    fontFamily: 'var(--font-body)',
                    color: 'var(--fg)',
                  }}
                  onFocus={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)';
                  }}
                  onBlur={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                />
              </div>
              <BtnPrimary onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                {searching ? '搜索中...' : '搜索'}
              </BtnPrimary>
            </div>
            {searchError && (
              <div className="flex items-center gap-1.5 mt-2" style={{ fontSize: 12, color: 'var(--danger)' }}>
                <AlertCircle className="w-3 h-3" /> {searchError}
              </div>
            )}
            {searchResults !== null && searchResults.length === 0 && !searchError && (
              <p className="mt-3" style={{ fontSize: 13, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>
                未找到相关内容
              </p>
            )}
            {searchResults && searchResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {searchResults.map((r: any, idx: number) => (
                  <div key={r.chunk_id || idx} className="rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--border-soft)' }}>
                    <div style={{ fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--font-body)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)' }}>
                        {r.document_name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, fontFamily: 'var(--font-body)' }}>
                        相似度: {(r.score * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部模型信息（只读） */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 20 }}>
        <div className="setting-group-label" style={{ marginBottom: 6 }}>模型信息</div>
        <p style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)', marginBottom: 12 }}>
          当前使用的嵌入和重排序模型，在"工具设置"中修改
        </p>
        <div style={{ display: 'flex', gap: 32 }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-soft)' }}>
              嵌入模型
            </span>
            <p style={{ fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--font-body)', marginTop: 4 }}>
              {embModelName || '未配置'}
            </p>
          </div>
          <div>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-soft)' }}>
              重排序模型
            </span>
            <p style={{ fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--font-body)', marginTop: 4 }}>
              {rerankModelName || '未配置'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
