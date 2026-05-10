import type { Assistant, Conversation } from '../types';
import { cn } from '../lib/utils';
import { Plus, MoreHorizontal, MessageSquare, Settings, Database, Brain, Pencil, Trash2, User } from 'lucide-react';
import EmojiIcon from './shared/EmojiIcon';
import { useState, useEffect, useRef } from 'react';

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
  isSettingsMode: boolean;
  onToggleSettings: (enabled: boolean) => void;
  settingsTab: 'model' | 'rag' | 'memory' | 'profile';
  onSettingsTabChange: (tab: 'model' | 'rag' | 'memory' | 'profile') => void;
  sidebarTab: 'assistants' | 'topics';
  onSidebarTabChange: (tab: 'assistants' | 'topics') => void;
}

export default function Sidebar({
  assistants, conversations, currentAssistantId, currentConversationId,
  onSelectAssistant, onSelectConversation, onCreateAssistant, onCreateConversation,
  onEditAssistant, onRemoveAssistant, onRemoveConversation, isSettingsMode, onToggleSettings, settingsTab, onSettingsTabChange,
  sidebarTab, onSidebarTabChange
}: SidebarProps) {

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [pendingDeleteConvId, setPendingDeleteConvId] = useState<string | null>(null);
  const [pendingDeleteAssistant, setPendingDeleteAssistant] = useState<Assistant | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
        setMenuPosition(null);
      }
    };
    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuId]);

  const handleMenuToggle = (assistantId: string, buttonEl: HTMLButtonElement) => {
    if (openMenuId === assistantId) {
      setOpenMenuId(null);
      setMenuPosition(null);
    } else {
      const rect = buttonEl.getBoundingClientRect();
      // 向右下方展开：左上角对齐按钮的左下角
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right,
      });
      setOpenMenuId(assistantId);
    }
  };

  const handleDelete = (assistant: Assistant) => {
    setOpenMenuId(null);
    setMenuPosition(null);
    setPendingDeleteAssistant(assistant);
  };

  const confirmDeleteAssistant = (confirmed: boolean) => {
    if (confirmed && pendingDeleteAssistant) {
      onRemoveAssistant(pendingDeleteAssistant.id);
    }
    setPendingDeleteAssistant(null);
  };

  const borderColor = 'var(--color-border)';
  const bgSoft = 'var(--color-background-soft)';
  const bgMute = 'var(--color-background-mute)';
  const textColor = 'var(--color-text)';
  const textSecondary = 'var(--color-text-2)';
  const primaryColor = 'var(--color-primary)';

  return (
    <>
    <div className="w-[280px] h-full flex flex-col shrink-0 border-r" style={{
      backgroundColor: bgSoft,
      borderColor,
    }}>
      {!isSettingsMode ? (
        <>
          {/* Tabs */}
          <div className="flex px-3 pt-3 pb-0 shrink-0 gap-1">
            <button
              className={cn(
                "flex-1 pb-2.5 text-sm font-medium transition-colors border-b-2",
                sidebarTab === 'assistants' ? 'border-current' : 'border-transparent hover:opacity-80'
              )}
              style={{
                color: sidebarTab === 'assistants' ? primaryColor : textSecondary,
              }}
              onClick={() => onSidebarTabChange('assistants')}
            >
              助手
            </button>
            <button
              className={cn(
                "flex-1 pb-2.5 text-sm font-medium transition-colors border-b-2",
                sidebarTab === 'topics' ? 'border-current' : 'border-transparent hover:opacity-80'
              )}
              style={{
                color: sidebarTab === 'topics' ? primaryColor : textSecondary,
              }}
              onClick={() => onSidebarTabChange('topics')}
            >
              话题
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sidebarTab === 'assistants' ? (
              <div>
                <button
                  onClick={onCreateAssistant}
                  className="mb-2 w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors"
                  style={{ color: textSecondary }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = bgMute)}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Plus className="w-4 h-4" />
                  新建助手
                </button>
                {assistants.map(assistant => (
                  <div
                    key={assistant.id}
                    onClick={() => onSelectAssistant(assistant.id)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors group mb-0.5"
                    )}
                    style={{
                      backgroundColor: currentAssistantId === assistant.id ? bgMute : 'transparent',
                    }}
                    onMouseEnter={e => { if (currentAssistantId !== assistant.id) e.currentTarget.style.backgroundColor = bgMute; }}
                    onMouseLeave={e => { if (currentAssistantId !== assistant.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <EmojiIcon emoji={assistant.emoji || '🤖'} size={32} fontSize={16} />
                    <div className="flex-1 overflow-hidden">
                      <div className="text-sm font-medium truncate" style={{ color: textColor }}>
                        {assistant.name}
                      </div>
                    </div>
                    <button
                      ref={el => { if (el) buttonRefs.current.set(assistant.id, el); else buttonRefs.current.delete(assistant.id); }}
                      onClick={(e) => { e.stopPropagation(); handleMenuToggle(assistant.id, e.currentTarget); }}
                      className={cn("p-1.5 rounded-lg transition-all hover:bg-black/10 shrink-0",
                        openMenuId === assistant.id ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                      style={{ color: textSecondary }}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <button
                  onClick={onCreateConversation}
                  className="mb-2 w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors"
                  style={{ color: textSecondary }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = bgMute)}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Plus className="w-4 h-4" />
                  新建话题
                </button>
                <div>
                  {conversations.filter(c => c.assistant_id === currentAssistantId).length === 0 ? (
                    <div className="text-center text-sm py-8" style={{ color: textSecondary }}>
                      暂无话题，选择助手开始对话
                    </div>
                  ) : (
                    conversations
                      .filter(c => c.assistant_id === currentAssistantId)
                      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                      .map(conversation => (
                        <div
                          key={conversation.id}
                          onClick={() => {
                            onSelectConversation(conversation.id);
                            setPendingDeleteConvId(null);
                          }}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors mb-0.5 group/conversation"
                          )}
                          style={{
                            backgroundColor: currentConversationId === conversation.id ? bgMute : 'transparent',
                            color: currentConversationId === conversation.id ? primaryColor : textColor,
                          }}
                          onMouseEnter={e => { if (currentConversationId !== conversation.id) e.currentTarget.style.backgroundColor = bgMute; }}
                          onMouseLeave={e => { if (currentConversationId !== conversation.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <MessageSquare className="w-4 h-4 shrink-0" style={{ opacity: 0.6 }} />
                          <div className="text-sm truncate flex-1">{conversation.title}</div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (pendingDeleteConvId === conversation.id) {
                                onRemoveConversation(conversation.id);
                                setPendingDeleteConvId(null);
                              } else {
                                setPendingDeleteConvId(conversation.id);
                              }
                            }}
                            className={cn(
                              "p-1 rounded transition-all opacity-0 group-hover/conversation:opacity-100",
                              pendingDeleteConvId === conversation.id ? "opacity-100 bg-red-100" : "hover:bg-black/10"
                            )}
                            style={{ color: pendingDeleteConvId === conversation.id ? '#dc2626' : textSecondary }}
                            title={pendingDeleteConvId === conversation.id ? '再次点击确认删除' : '删除话题'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col p-3">
          <div className="text-lg font-bold mb-5 px-2" style={{ color: textColor }}>系统设置</div>
          <div className="space-y-1">
            {([
              { key: 'model' as const, icon: Settings, label: '模型设置' },
              { key: 'rag' as const, icon: Database, label: 'RAG 知识库' },
              { key: 'memory' as const, icon: Brain, label: '全局记忆' },
              { key: 'profile' as const, icon: User, label: '个人信息' },
            ]).map(item => (
              <button
                key={item.key}
                onClick={() => onSettingsTabChange(item.key)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                style={{
                  backgroundColor: settingsTab === item.key ? 'var(--color-primary-mute)' : 'transparent',
                  color: settingsTab === item.key ? primaryColor : textSecondary,
                }}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => onToggleSettings(false)}
            className="mt-auto px-4 py-3 text-sm font-medium rounded-xl flex items-center gap-3 transition-colors border-t"
            style={{ color: textSecondary, borderColor }}
          >
            退出设置
          </button>
        </div>
      )}

      {!isSettingsMode && (
        <div className="p-3 border-t" style={{ borderColor }}>
          <button
            onClick={() => onToggleSettings(true)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors"
            style={{ color: textSecondary, backgroundColor: bgMute }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <Settings className="w-4 h-4" />
            设置
          </button>
        </div>
      )}
    </div>

    {/* 助手悬浮菜单 — 使用 fixed 定位避免被侧边栏 overflow 裁剪 */}
    {openMenuId && menuPosition && (() => {
      const assistant = assistants.find(a => a.id === openMenuId);
      if (!assistant) return null;
      return (
        <div ref={menuRef} className="fixed w-36 rounded-xl border shadow-lg py-1 z-[9999]"
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)',
          }}>
          <button
            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setMenuPosition(null); onEditAssistant(assistant); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-black/5 transition-colors"
            style={{ color: textColor }}
          >
            <Pencil className="w-3.5 h-3.5" />
            编辑助手
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(assistant); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-50 transition-colors"
            style={{ color: '#dc2626' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除助手
          </button>
        </div>
      );
    })()}

    {/* 删除确认弹窗 — 自定义弹窗替代浏览器 confirm */}
    {pendingDeleteAssistant && (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onClick={() => confirmDeleteAssistant(false)}>
        <div className="w-80 rounded-2xl shadow-2xl p-6"
          style={{ backgroundColor: 'var(--color-background)' }}
          onClick={e => e.stopPropagation()}>
          <div className="text-lg font-bold mb-3" style={{ color: 'var(--color-text)' }}>
            确认删除
          </div>
          <div className="text-sm mb-6" style={{ color: 'var(--color-text-2)' }}>
            确定要删除助手「{pendingDeleteAssistant.name}」吗？此操作不可撤销。
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => confirmDeleteAssistant(false)}
              className="px-5 py-2 rounded-lg text-sm font-medium border transition-colors"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}
            >
              取消
            </button>
            <button
              onClick={() => confirmDeleteAssistant(true)}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: '#dc2626' }}
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
