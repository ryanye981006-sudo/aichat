// 桌面窗口框架 — 模拟标题栏 + 窗口控件 + 全屏/小窗切换
import { ReactNode, useState, useCallback, useEffect, useRef } from 'react';

interface WindowFrameProps {
  showWindowFrame: boolean;
  onToggleWindowed: () => void;
  isWindowed: boolean;
  children: ReactNode;
}

const api = (typeof window !== 'undefined' && (window as any).electronAPI) || null;

// 根据容器宽度计算侧边栏宽度
function sidebarWidthFor(containerWidth: number): string {
  if (containerWidth > 1400) return 'var(--sidebar-w-wide)';
  if (containerWidth >= 1100) return 'var(--sidebar-w-normal)';
  return 'var(--sidebar-w-compact)';
}

export default function WindowFrame({ showWindowFrame, onToggleWindowed, isWindowed, children }: WindowFrameProps) {
  const [transitioning, setTransitioning] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMounted(true); }, []);

  // 监听窗口最大化状态
  useEffect(() => {
    if (!api) return;
    const onMaximize = () => setIsMaximized(true);
    const onUnmaximize = () => setIsMaximized(false);

    const checkInitial = async () => {
      try {
        // 通过 Electron API 获取初始最大化状态（可选）
      } catch {}
    };
    checkInitial();

    // 监听窗口 resize 判断是否最大化（无边框窗口需要此方法来检测）
    const onResize = () => {
      if (window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight) {
        setIsMaximized(true);
      } else {
        setIsMaximized(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
    if (api) {
      api.maximizeWindow(); // 切换 最大化/还原
    } else {
      onToggleWindowed();
    }
    setTimeout(() => setTransitioning(false), 450);
  }, [transitioning, onToggleWindowed]);

  const handleMinimize = useCallback(() => {
    if (api) api.minimizeWindow();
  }, []);

  const handleClose = useCallback(() => {
    if (api) api.closeWindow();
  }, []);

  if (!showWindowFrame) {
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: 'var(--bg)',
        position: 'relative',
      }}
    >
      {/* 标题栏 — 可拖拽 */}
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
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
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

        {/* 窗口控件 — 不可拖拽 */}
        <div style={{ display: 'flex', alignItems: 'center', height: '100%', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WindowCtrl title="最小化" onClick={handleMinimize}>
            <svg width="10" height="2" viewBox="0 0 10 2"><rect width="10" height="2" fill="currentColor" /></svg>
          </WindowCtrl>
          <WindowCtrl title={isMaximized ? '还原' : '最大化'} onClick={handleToggle}>
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            )}
          </WindowCtrl>
          <WindowCtrl title="关闭" isClose onClick={handleClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </WindowCtrl>
        </div>
      </div>

      {/* 内容区 — 100% 撑满 */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', position: 'relative' }}>
        {children}
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
        color: 'var(--muted-soft)',
        borderRadius: 0,
        transition: 'background 0.1s, color 0.1s',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
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
