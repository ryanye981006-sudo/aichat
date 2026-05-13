import { ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

interface WindowFrameProps {
  isWindowed: boolean;
  onToggleWindowed: () => void;
  children: ReactNode;
}

export default function WindowFrame({ isWindowed, onToggleWindowed, children }: WindowFrameProps) {
  if (!isWindowed) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--color-window-bg, #e8e8e8)',
        padding: '40px 20px',
      }}
    >
      <div
        style={{
          width: '1200px',
          height: '800px',
          maxWidth: '98vw',
          maxHeight: '98vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '10px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)',
          overflow: 'hidden',
          backgroundColor: 'var(--color-background)',
        }}
      >
        {/* 模拟标题栏 */}
        <div
          style={{
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            backgroundColor: 'var(--color-surface, #f5f5f5)',
            borderBottom: '1px solid var(--color-border, #e0e0e0)',
            cursor: 'default',
            userSelect: 'none',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '12px',
              color: 'var(--color-text-secondary, #666)',
              fontWeight: 500,
            }}
          >
            aichat
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* 全屏切换按钮 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWindowed();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                borderRadius: '4px',
                color: 'var(--color-text-secondary, #666)',
                padding: 0,
              }}
              title="退出窗口预览"
            >
              <Maximize2 size={13} />
            </button>
            {/* 窗口控件装饰 */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                borderRadius: '4px',
              }}
              title="最小化（装饰）"
            >
              <Minimize2 size={13} style={{ color: 'var(--color-text-tertiary, #999)' }} />
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                borderRadius: '4px',
              }}
              title="最大化（装饰）"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-tertiary, #999)' }}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                borderRadius: '4px',
                color: 'var(--color-text-tertiary, #999)',
              }}
              title="关闭（装饰）"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          </div>
        </div>
        {/* 窗口内容区 */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
