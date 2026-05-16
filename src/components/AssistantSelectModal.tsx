// 助手选择弹窗：切换助手 + 新建助手入口
import type { Assistant } from '../types';
import { Plus } from 'lucide-react';
import EmojiIcon from './shared/EmojiIcon';

interface AssistantSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistants: Assistant[];
  currentAssistantId: string | null;
  onSelectAssistant: (id: string) => void;
  onCreateAssistant: () => void;
}

export default function AssistantSelectModal({
  isOpen, onClose, assistants, currentAssistantId, onSelectAssistant, onCreateAssistant,
}: AssistantSelectModalProps) {
  if (!isOpen) return null;

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
        className="rounded-[18px] w-full max-w-[380px] flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex justify-between items-center border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <h3
            className="text-[17px] font-semibold"
            style={{ color: 'var(--fg)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}
          >
            切换助手
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

        {/* Assistant List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {assistants.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--muted-soft)' }}>
              暂无助手，请创建一个
            </div>
          ) : (
            assistants.map(a => (
              <div
                key={a.id}
                onClick={() => { onSelectAssistant(a.id); onClose(); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  backgroundColor: currentAssistantId === a.id ? 'var(--accent-dim)' : 'transparent',
                }}
                onMouseEnter={e => {
                  if (currentAssistantId !== a.id)
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)';
                }}
                onMouseLeave={e => {
                  if (currentAssistantId !== a.id)
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }}
              >
                <EmojiIcon emoji={a.emoji || '🤖'} size={32} fontSize={18} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                    {a.name}
                  </div>
                  <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--muted)' }}>
                    {a.model_id ? a.model_id : '未选择模型'}
                  </div>
                </div>
                {currentAssistantId === a.id && (
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
                  >
                    当前
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer: 新增助手 */}
        <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => { onCreateAssistant(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border-2"
            style={{
              borderStyle: 'dashed',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent-dim)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            <Plus className="w-4 h-4" />
            新增助手
          </button>
        </div>
      </div>
    </div>
  );
}
