// 侧边栏 v3 — 纯粹的历史会话导航
// 顶部：开始新对话（吸顶）| 中部：当前助手的对话列表 | 底部：切换助手 + 设置
import type { Conversation } from '../types';
import { cn } from '../lib/utils';
import { Plus, Settings, MessageSquare, Trash2, ArrowLeftRight } from 'lucide-react';
import { Tooltip } from 'antd';
import { useState } from 'react';

// ===== 时间格式化 =====
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDay = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

  if (diffDay === 0) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return `${diffDay}天前`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYear(iso: string): number {
  return new Date(iso).getFullYear();
}

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onRemoveConversation: (id: string) => void;
  onOpenSettings: () => void;
  onSwitchAssistant: () => void;
}

export default function Sidebar({
  conversations, currentConversationId,
  onSelectConversation, onCreateConversation, onRemoveConversation,
  onOpenSettings, onSwitchAssistant,
}: SidebarProps) {

  const [pendingDeleteConvId, setPendingDeleteConvId] = useState<string | null>(null);

  // 构建带年份分割线的会话列表
  const items: Array<{ type: 'year'; year: number } | { type: 'conv'; conv: Conversation }> = [];
  let prevYear: number | null = null;
  for (const conv of conversations) {
    const year = getYear(conv.updated_at);
    if (prevYear !== null && prevYear !== year) {
      items.push({ type: 'year', year: prevYear });
    }
    items.push({ type: 'conv', conv });
    prevYear = year;
  }

  const empty = conversations.length === 0;

  return (
    <div
      className="h-full flex flex-col shrink-0 border-r select-none"
      style={{
        width: 'var(--sidebar-w)',
        transition: 'width 0.3s var(--ease-out-standard)',
        backgroundColor: 'var(--sidebar-bg)',
        borderColor: 'var(--border)',
      }}
    >
      {/* ===== 顶部：切换助手 + 开始新对话（吸顶） ===== */}
      <div className="px-3 pt-3 pb-2 shrink-0 sticky top-0 z-10 flex flex-col gap-2" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
        {/* 切换助手 — accent 风格 */}
        <button
          onClick={onSwitchAssistant}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{
            background: 'linear-gradient(135deg, var(--accent), #6a82ce)',
            color: '#fff',
            boxShadow: 'var(--shadow-button)',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.opacity = '0.92';
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.01)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.opacity = '1';
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
          }}
        >
          <ArrowLeftRight className="w-4 h-4" />
          切换助手
        </button>
        {/* 开始新对话 — border 风格 */}
        <button
          onClick={onCreateConversation}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-colors border"
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
          <Plus className="w-4 h-4" />
          开始新对话
        </button>
      </div>

      {/* ===== 中部：会话列表（可滚动） ===== */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {empty ? (
          <div className="text-center text-sm py-10" style={{ color: 'var(--muted-soft)' }}>
            <div className="mb-2 opacity-40">
              <MessageSquare className="w-10 h-10 mx-auto" />
            </div>
            <div>暂无历史对话</div>
            <div className="text-xs mt-1 opacity-60">点击上方「开始新对话」发起聊天</div>
          </div>
        ) : (
          items.map(item => {
            if (item.type === 'year') {
              return (
                <div key={`y-${item.year}`} className="flex items-center justify-center py-1 my-0.5">
                  <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--muted-soft)' }}>
                    —— {item.year}年 ——
                  </span>
                </div>
              );
            }
            const conv = item.conv;
            const isPending = pendingDeleteConvId === conv.id;
            return (
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
                {/* 标题：弹性占满 + 单行截断 + Tooltip 完整显示 */}
                <Tooltip title={conv.title} mouseEnterDelay={0.5}>
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
                </Tooltip>
                {/* 时间：默认显示，悬浮或待确认时隐藏 */}
                <span
                  className={cn(
                    'text-xs shrink-0 tabular-nums',
                    isPending && 'hidden',
                    'group-hover/conv:hidden'
                  )}
                  style={{
                    color: 'var(--muted-soft)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {fmtTime(conv.updated_at)}
                </span>
                {/* 删除按钮：悬浮或待确认时原位展示，柔和红色 */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (isPending) {
                      onRemoveConversation(conv.id);
                      setPendingDeleteConvId(null);
                    } else {
                      setPendingDeleteConvId(conv.id);
                    }
                  }}
                  className={cn(
                    'p-1 rounded transition-all shrink-0',
                    isPending ? 'inline-flex' : 'hidden group-hover/conv:inline-flex'
                  )}
                  style={{
                    color: 'var(--danger)',
                    opacity: isPending ? 1 : 0.55,
                    backgroundColor: isPending ? 'rgba(212, 96, 106, 0.08)' : 'transparent',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.opacity = '1';
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(212, 96, 106, 0.06)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.opacity = isPending ? '1' : '0.55';
                    (e.currentTarget as HTMLElement).style.backgroundColor = isPending ? 'rgba(212, 96, 106, 0.08)' : 'transparent';
                  }}
                  title={isPending ? '再次点击确认删除' : '删除对话'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* ===== 底部：设置 ===== */}
      <div className="p-3 border-t shrink-0" style={{ borderColor: 'var(--border)' }}>
        {/* 设置 */}
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
  );
}
