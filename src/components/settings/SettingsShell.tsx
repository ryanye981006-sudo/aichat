// 设置页外壳 — 全屏覆盖 + 左导航 + 右内容区
import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

export type SettingsTab = 'model' | 'memory' | 'tools' | 'pet';

interface SettingsShellProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
  children: ReactNode;
}

const NAV_ITEMS: { key: SettingsTab; label: string }[] = [
  { key: 'model', label: '模型设置' },
  { key: 'memory', label: '长期记忆' },
  { key: 'tools', label: '工具设置' },
  { key: 'pet', label: '桌宠管理' },
];

export default function SettingsShell({ activeTab, onTabChange, onClose, children }: SettingsShellProps) {
  return (
    <div
      className="absolute inset-0 z-40 flex"
      style={{
        backgroundColor: 'var(--surface)',
      }}
    >
      {/* 左导航 */}
      <nav
        className="h-full flex flex-col shrink-0 border-r"
        style={{
          width: 'var(--sidebar-w)',
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex-1 overflow-y-auto" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              className="w-full text-left transition-colors"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: activeTab === item.key ? 'var(--accent-dim)' : 'transparent',
                fontSize: 13,
                fontWeight: activeTab === item.key ? 600 : 500,
                letterSpacing: '0.01em',
                fontFamily: 'var(--font-body)',
                color: activeTab === item.key ? 'var(--accent)' : 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 返回按钮 */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center gap-1.5 transition-colors"
            style={{
              padding: '8px 0',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'transparent',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.02em',
              fontFamily: 'var(--font-body)',
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
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
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
