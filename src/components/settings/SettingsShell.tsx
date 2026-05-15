// 设置页外壳 — 全屏覆盖 + 左导航 + 右内容区
import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

export type SettingsTab = 'model' | 'memory' | 'tools';

interface SettingsShellProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
  children: ReactNode;
}

const NAV_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: 'model', label: '模型设置', icon: '⚙' },
  { key: 'memory', label: '长期记忆', icon: '🧠' },
  { key: 'tools', label: '工具设置', icon: '🔧' },
];

export default function SettingsShell({ activeTab, onTabChange, onClose, children }: SettingsShellProps) {
  return (
    <div
      className="absolute inset-0 z-40 flex"
      style={{
        backgroundColor: 'var(--bg)',
      }}
    >
      {/* 左导航 */}
      <nav
        className="w-[262px] h-full flex flex-col shrink-0 border-r"
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <div
            className="px-3 pb-4 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}
          >
            系统设置
          </div>
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors text-left"
              style={{
                backgroundColor: activeTab === item.key ? 'var(--accent-dim)' : 'transparent',
                color: activeTab === item.key ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        {/* 返回按钮 */}
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={onClose}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors"
            style={{ color: 'var(--muted)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hover-bg)';
              (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              (e.currentTarget as HTMLElement).style.color = 'var(--muted)';
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
        </div>
      </nav>

      {/* 右内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 设置内容 Header */}
        <div
          className="px-6 py-[18px] border-b flex items-center gap-2.5 shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--fg)',
              flex: 1,
            }}
          >
            {NAV_ITEMS.find(i => i.key === activeTab)?.label || '设置'}
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--chat-bg)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
