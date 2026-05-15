// 侧边栏（v2 新设计）：助手下拉选择器 + 按助手分组的对话列表
import type { Assistant, Conversation } from '../types';
import { cn } from '../lib/utils';
import { Plus, ChevronDown, Settings, MessageSquare, Trash2, Pencil } from 'lucide-react';
import EmojiIcon from './shared/EmojiIcon';
import { useState, useRef, useEffect } from 'react';

// ===== 时间格式化 =====
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHr < 24) return `${diffHr}小时前`;
  if (diffHr < 48) return '昨天';
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ===== 分组对话类型 =====
interface ConvGroup {
  assistant: Assistant;
  conversations: Conversation[];
}

interface SidebarProps {
  assistants: Assistant[];
  conversations: Conversation[];
  currentAssistantId: string | null;
  currentConversationId: string | null;
  onSelectAssistant: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onCreateAssistant: () => void;
  onCreateConversation: () => void;
  onEditAssistant: (assistant: Assistant) => void;
  onRemoveAssistant: (id: string) => void;
  onRemoveConversation: (id: string) => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  assistants, conversations, currentAssistantId, currentConversationId,
  onSelectAssistant, onSelectConversation, onCreateAssistant, onCreateConversation,
  onEditAssistant, onRemoveAssistant, onRemoveConversation, onOpenSettings,
}: SidebarProps) {

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [gearMenuOpen, setGearMenuOpen] = useState(false);
  const [pendingDeleteConvId, setPendingDeleteConvId] = useState<string | null>(null);
  const [pendingDeleteAssistant, setPendingDeleteAssistant] = useState<Assistant | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const gearBtnRef = useRef<HTMLButtonElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!dropdownOpen) return;
    const h = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [dropdownOpen]);

  // 点击外部关闭齿轮菜单
  useEffect(() => {
    if (!gearMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (gearBtnRef.current && !gearBtnRef.current.contains(e.target as Node) &&
          gearBtnRef.current.nextElementSibling && !gearBtnRef.current.nextElementSibling.contains(e.target as Node)) {
        setGearMenuOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [gearMenuOpen]);

  const currentAssistant = assistants.find(a => a.id === currentAssistantId) || null;

  // 对话按助手分组，按时间排序
  const groups: ConvGroup[] = assistants
    .map(a => ({
      assistant: a,
      conversations: conversations
        .filter(c => c.assistant_id === a.id)
        .sort((x, y) => new Date(y.updated_at).getTime() - new Date(x.updated_at).getTime()),
    }))
    .filter(g => g.conversations.length > 0);

  const empty = conversations.length === 0;

  return (
    <>
      <div
        className="w-[262px] h-full flex flex-col shrink-0 border-r select-none"
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--border)',
        }}
      >
        {/* ===== 顶部：助手选择器 + 操作按钮 ===== */}
        <div className="px-3 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            {/* 助手下拉 */}
            <div ref={dropdownRef} style={{ position: 'relative', flex: 1 }}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left"
                style={{
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--fg)',
                  boxShadow: '0 1px 2px rgba(70, 85, 120, 0.04)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#fff';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(85, 112, 184, 0.1)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--surface)';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(70, 85, 120, 0.04)';
                }}
              >
                <EmojiIcon emoji={currentAssistant?.emoji || '🤖'} size={22} fontSize={16} />
                <span className="flex-1 text-sm font-medium truncate">
                  {currentAssistant?.name || '选择助手'}
                </span>
                <ChevronDown
                  className="w-[10px] h-[10px] shrink-0 transition-transform duration-200"
                  style={{
                    color: 'var(--muted)',
                    transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              </button>

              {dropdownOpen && (
                <div
                  className="absolute left-0 right-0 top-full mt-1 rounded-xl border py-1 z-50"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    boxShadow: 'var(--shadow-dropdown)',
                  }}
                >
                  {assistants.map(a => (
                    <div
                      key={a.id}
                      onClick={() => { onSelectAssistant(a.id); setDropdownOpen(false); }}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors"
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
                      <EmojiIcon emoji={a.emoji || '🤖'} size={24} fontSize={12} />
                      <span className="flex-1 text-sm truncate" style={{ color: 'var(--fg)' }}>{a.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 齿轮按钮 — 操作当前助手 */}
            <div style={{ position: 'relative' }}>
              <button
                ref={gearBtnRef}
                onClick={() => setGearMenuOpen(!gearMenuOpen)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors border shrink-0"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
                title="助手操作"
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
              {gearMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 rounded-lg border py-1 z-50 min-w-[140px]"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    boxShadow: 'var(--shadow-dropdown)',
                  }}
                >
                  <button
                    onClick={() => { setGearMenuOpen(false); currentAssistant && onEditAssistant(currentAssistant); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
                    style={{ color: 'var(--fg)' }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent-dim)';
                      (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                      (e.currentTarget as HTMLElement).style.color = 'var(--fg)';
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    编辑助手
                  </button>
                  <button
                    onClick={() => { setGearMenuOpen(false); currentAssistant && setPendingDeleteAssistant(currentAssistant); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
                    style={{ color: 'var(--danger)' }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(212,96,106,0.1)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除助手
                  </button>
                </div>
              )}
            </div>

            {/* 新建助手按钮 */}
            <button
              onClick={onCreateAssistant}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors border shrink-0"
              style={{
                borderColor: 'var(--border)',
                background: 'linear-gradient(135deg, var(--accent), #6a82ce)',
                color: '#fff',
                boxShadow: 'var(--shadow-button)',
              }}
              title="新建助手"
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.opacity = '0.9';
                (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.opacity = '1';
                (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
              }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ===== 中部：消息标签 + 新对话 ===== */}
        <div className="px-3 py-1 shrink-0 flex items-center justify-between">
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as any,
              color: 'var(--muted-soft)',
            }}
          >
            消息
          </span>
          <button
            onClick={onCreateConversation}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              border: '1px dashed var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              letterSpacing: '0.01em',
            }}
            title="新建对话"
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent-dim)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            + 新对话
          </button>
        </div>

        {/* ===== 对话列表（按助手分组） ===== */}
        <div className="flex-1 overflow-y-auto px-3 py-1">
          {empty ? (
            <div className="text-center text-sm py-8" style={{ color: 'var(--muted-soft)' }}>
              选择助手开始对话
            </div>
          ) : (
            groups.map(group => (
              <div key={group.assistant.id} className="mb-3">
                {/* 组眉：emoji + 助手名 */}
                <div className="flex items-center gap-2 px-1 py-1 mb-0.5">
                  <span style={{ fontSize: 10 }}>{group.assistant.emoji || '🤖'}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--muted-soft)', textTransform: 'uppercase' as any }}>
                    {group.assistant.name}
                  </span>
                </div>
                {/* 对话项 */}
                {group.conversations.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => {
                      onSelectConversation(conv.id);
                      setPendingDeleteConvId(null);
                    }}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all mb-0.5 group/conv',
                      currentConversationId === conv.id ? 'relative' : ''
                    )}
                    style={{
                      backgroundColor: currentConversationId === conv.id
                        ? 'var(--active-bg)'
                        : 'transparent',
                    }}
                    onMouseEnter={e => {
                      if (currentConversationId !== conv.id)
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={e => {
                      if (currentConversationId !== conv.id)
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    {/* active 态左侧指示条 */}
                    {currentConversationId === conv.id && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 8,
                          bottom: 8,
                          width: 3,
                          borderRadius: '0 2px 2px 0',
                          backgroundColor: 'var(--accent)',
                        }}
                      />
                    )}
                    <MessageSquare
                      className="w-4 h-4 shrink-0"
                      style={{
                        color: currentConversationId === conv.id
                          ? 'var(--accent)'
                          : 'var(--muted-soft)',
                      }}
                    />
                    <span
                      className="text-sm truncate flex-1"
                      style={{
                        color: currentConversationId === conv.id
                          ? 'var(--accent)'
                          : 'var(--fg)',
                        fontWeight: currentConversationId === conv.id ? 500 : 400,
                      }}
                    >
                      {conv.title}
                    </span>
                    <span
                      className="text-xs shrink-0 tabular-nums"
                      style={{
                        color: 'var(--muted-soft)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {fmtTime(conv.updated_at)}
                    </span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (pendingDeleteConvId === conv.id) {
                          onRemoveConversation(conv.id);
                          setPendingDeleteConvId(null);
                        } else {
                          setPendingDeleteConvId(conv.id);
                        }
                      }}
                      className={cn(
                        'p-1 rounded transition-all shrink-0',
                        pendingDeleteConvId === conv.id
                          ? 'opacity-100'
                          : 'opacity-0 group-hover/conv:opacity-100'
                      )}
                      style={{
                        color: pendingDeleteConvId === conv.id
                          ? 'var(--danger)'
                          : 'var(--muted-soft)',
                        backgroundColor: pendingDeleteConvId === conv.id
                          ? 'rgba(212, 96, 106, 0.1)'
                          : 'transparent',
                      }}
                      title={pendingDeleteConvId === conv.id ? '再次点击确认删除' : '删除对话'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* ===== 底部：设置按钮 ===== */}
        <div className="p-3 border-t shrink-0" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-colors border"
            style={{
              color: 'var(--muted)',
              borderColor: 'var(--border)',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = 'var(--accent-dim)';
              el.style.color = 'var(--accent)';
              el.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = 'transparent';
              el.style.color = 'var(--muted)';
              el.style.borderColor = 'var(--border)';
            }}
          >
            <Settings className="w-4 h-4" />
            设置
          </button>
        </div>
      </div>

      {/* ===== 删除助手确认弹窗 ===== */}
      {pendingDeleteAssistant && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(50, 58, 85, 0.4)', backdropFilter: 'blur(2px)' }}
          onClick={() => setPendingDeleteAssistant(null)}
        >
          <div
            className="w-80 rounded-2xl shadow-2xl p-6"
            style={{ backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-modal)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-lg font-bold mb-3" style={{ color: 'var(--fg)' }}>
              确认删除
            </div>
            <div className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
              确定要删除助手「{pendingDeleteAssistant.name}」吗？此操作不可撤销。
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setPendingDeleteAssistant(null)}
                className="px-5 py-2 rounded-lg text-sm font-medium border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  onRemoveAssistant(pendingDeleteAssistant.id);
                  setPendingDeleteAssistant(null);
                }}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors rounded-lg"
                style={{ backgroundColor: 'var(--danger)' }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
