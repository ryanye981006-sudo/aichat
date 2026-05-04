import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { Provider, Model } from '../../types';
import { cn } from '../../lib/utils';

interface ModelSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (providerId: string, modelId: string) => void;
  providers: Provider[];
  models: Model[];
  currentModelId: string;
}

export default function ModelSelectModal({ isOpen, onClose, onSelect, providers, models, currentModelId }: ModelSelectModalProps) {
  const [search, setSearch] = useState('');

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.display_name && m.display_name.toLowerCase().includes(q))
    );
  }, [models, search]);

  // 按供应商分组
  const grouped = useMemo(() => {
    const map = new Map<string, { provider: Provider; models: Model[] }>();
    for (const m of filteredModels) {
      const p = providers.find(pr => pr.id === m.provider_id);
      if (!p) continue;
      if (!map.has(p.id)) map.set(p.id, { provider: p, models: [] });
      map.get(p.id)!.models.push(m);
    }
    return Array.from(map.values());
  }, [filteredModels, providers]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl w-full max-w-[560px] shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-background)', height: '520px' }}>
        {/* Header */}
        <div className="px-5 py-3.5 flex justify-between items-center border-b shrink-0"
          style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>选择模型</h3>
          <button type="button" onClick={onClose}
            className="text-2xl leading-none hover:opacity-70" style={{ color: 'var(--color-text-3)' }}>
            &times;
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border"
            style={{ backgroundColor: 'var(--color-background-soft)', borderColor: 'var(--color-border)' }}>
            <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--color-text-3)' }} />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索模型名称..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--color-text)' }}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="text-sm hover:opacity-70" style={{ color: 'var(--color-text-3)' }}>
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Model List — 固定高度，内部滚动 */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {grouped.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--color-text-3)' }}>
              未找到匹配的模型
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(({ provider, models: groupModels }) => (
                <div key={provider.id}>
                  <div className="text-xs font-semibold px-1 py-1 mb-1.5 sticky top-0 z-10" style={{ color: 'var(--color-text-2)', backgroundColor: 'var(--color-background)' }}>
                    {provider.name}
                  </div>
                  <div className="space-y-0.5">
                    {groupModels.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelect(provider.id, m.id);
                          onClose();
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between",
                          m.id === currentModelId ? "font-semibold" : ""
                        )}
                        style={{
                          backgroundColor: m.id === currentModelId ? 'var(--color-primary-mute)' : 'transparent',
                          color: 'var(--color-text)',
                        }}
                        onMouseEnter={e => {
                          if (m.id !== currentModelId) {
                            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-background-soft)';
                          }
                        }}
                        onMouseLeave={e => {
                          if (m.id !== currentModelId) {
                            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <span>{m.display_name || m.name}</span>
                        {m.id === currentModelId && (
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-primary)' }} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
