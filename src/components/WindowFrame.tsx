// 桌面窗口框架 — 模拟标题栏 + 窗口控件 + 全屏/小窗切换
import { ReactNode, useState, useCallback, useEffect, useRef } from 'react';

interface WindowFrameProps {
  showWindowFrame: boolean;
  onToggleWindowed: () => void;
  isWindowed: boolean;
  children: ReactNode;
}

// 根据容器宽度计算侧边栏宽度
function sidebarWidthFor(containerWidth: number): string {
  if (containerWidth > 1400) return 'var(--sidebar-w-wide)';
  if (containerWidth >= 1100) return 'var(--sidebar-w-normal)';
  return 'var(--sidebar-w-compact)';
}

export default function WindowFrame({ showWindowFrame, onToggleWindowed, isWindowed, children }: WindowFrameProps) {
  const [transitioning, setTransitioning] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMounted(true); }, []);

  // 监听容器宽度变化，动态更新 --sidebar-w CSS 变量
  useEffect(() => {
    const el = containerRef.current;
    if (!el && showWindowFrame) return;

    const apply = (width: number) => {
      document.documentElement.style.setProperty('--sidebar-w', sidebarWidthFor(width));
    };

    if (showWindowFrame && el) {
      const observer = new ResizeObserver(([entry]) => {
        apply(entry.contentRect.width);
      });
      observer.observe(el);
      apply(el.getBoundingClientRect().width);
      return () => observer.disconnect();
    }

    // 无窗口框架时，监听窗口尺寸
    const onResize = () => apply(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showWindowFrame, isWindowed]);

  const handleToggle = useCallback(() => {
    if (transitioning) return;
    setTransitioning(true);
    onToggleWindowed();
    setTimeout(() => setTransitioning(false), 450);
  }, [transitioning, onToggleWindowed]);

  if (!showWindowFrame) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#354060',
        backgroundImage: 'radial-gradient(ellipse at 50% 30%, #4a5980 0%, #2d3655 80%)',
        padding: 20,
      }}
    >
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          background: 'var(--bg)',
          boxShadow: 'var(--shadow-window)',
          width: isWindowed ? 900 : 1200,
          height: isWindowed ? 680 : 800,
          minWidth: isWindowed ? 600 : undefined,
          minHeight: isWindowed ? 460 : undefined,
          maxWidth: isWindowed ? '95vw' : undefined,
          maxHeight: isWindowed ? '90vh' : undefined,
          transition: mounted ? `width 0.45s var(--ease-out-standard), height 0.45s var(--ease-out-standard)` : 'none',
          position: 'relative',
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            height: 'var(--titlebar-h)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            background: 'var(--sidebar-bg)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            userSelect: 'none',
            gap: 10,
          }}
        >
          {/* Logo */}
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: 'linear-gradient(135deg, var(--accent), #7b92ce)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: '0 1px 3px rgba(68,96,168,0.25)',
            }}
          >
            A
          </div>
          {/* 标题 */}
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--font-display)',
              color: 'var(--muted)',
              flex: 1,
            }}
          >
            aichat
          </span>

          {/* 窗口控件 */}
          <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <WindowCtrl title="最小化" onClick={() => {}}>
              <svg width="10" height="2" viewBox="0 0 10 2"><rect width="10" height="2" fill="currentColor" /></svg>
            </WindowCtrl>
            <WindowCtrl title={isWindowed ? '最大化' : '窗口化'} onClick={handleToggle}>
              {isWindowed ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                  <path d="M17 9h-3.5a2 2 0 0 0-2 2V15" />
                </svg>
              )}
            </WindowCtrl>
            <WindowCtrl title="关闭" isClose onClick={() => {}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </WindowCtrl>
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {children}
        </div>

        {/* 小窗右下角拖拽手柄 */}
        {isWindowed && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 18,
              height: 18,
              cursor: 'nwse-resize',
              zIndex: 100,
              background: 'linear-gradient(135deg, transparent 0%, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%, transparent 65%, var(--border) 65%, var(--border) 75%, transparent 75%, transparent 80%, var(--border) 80%, var(--border) 90%, transparent 90%)',
            }}
          />
        )}
      </div>
    </div>
  );
}

function WindowCtrl({ title, onClick, isClose, children }: { title: string; onClick: () => void; isClose?: boolean; children: ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 46,
        height: 32,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        color: isClose ? 'var(--muted-soft)' : 'var(--muted-soft)',
        borderRadius: 0,
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => {
        if (isClose) {
          (e.target as HTMLElement).style.background = 'var(--danger)';
          (e.target as HTMLElement).style.color = '#fff';
        } else {
          (e.target as HTMLElement).style.background = 'var(--hover-bg)';
        }
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.background = 'none';
        (e.target as HTMLElement).style.color = 'var(--muted-soft)';
      }}
    >
      {children}
    </button>
  );
}
