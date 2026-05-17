// 设计系统原语组件：Toggle / 按钮 / FormInput / ModalShell / GearMenu
// 所有组件仅使用设计系统 CSS 变量，禁止硬编码色值

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

// ===== Toggle 开关 (42×24px) =====
export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        'relative inline-flex items-center rounded-full transition-all duration-250 shrink-0',
        checked
          ? ''
          : ''
      )}
      style={{
        width: 42,
        height: 24,
        borderRadius: 12,
        background: checked ? 'var(--accent)' : 'var(--border)',
        boxShadow: checked ? '0 1px 3px rgba(85,112,184,0.3)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: `background 250ms ${'cubic-bezier(0.32,0.72,0,1)'}, box-shadow 250ms ${'cubic-bezier(0.32,0.72,0,1)'}`,
      }}
      onClick={onChange}
    >
      <motion.span
        className="inline-block bg-white rounded-full"
        style={{
          width: 20,
          height: 20,
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

// ===== 按钮变体 =====
function btnBase(props: {
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
  title?: string;
  type?: 'button' | 'submit';
}) {
  return {
    disabled: props.disabled,
    onClick: props.onClick,
    title: props.title,
    type: (props.type || 'button') as 'button' | 'submit',
    className: cn(
      'inline-flex items-center justify-center font-medium transition-all duration-150 select-none',
      props.disabled && 'opacity-25 pointer-events-none',
      props.className
    ),
    children: props.children,
  };
}

export function BtnPrimary(props: { disabled?: boolean; onClick?: () => void; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <button {...btnBase({ ...props, type: 'button' })}
      style={{
        padding: '9px 18px',
        borderRadius: 'var(--radius-md)',
        background: 'linear-gradient(135deg, var(--accent), #6a82ce)',
        color: '#fff',
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: '0.01em',
        boxShadow: 'var(--shadow-button)',
        transform: 'translateY(0)',
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.boxShadow = 'var(--shadow-button-hover)'; (e.target as HTMLElement).style.transform = 'scale(1.02)'; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.boxShadow = 'var(--shadow-button)'; (e.target as HTMLElement).style.transform = 'scale(1)'; }}
      onMouseDown={(e) => { (e.target as HTMLElement).style.transform = 'scale(0.96)'; (e.target as HTMLElement).style.boxShadow = 'none'; }}
      onMouseUp={(e) => { (e.target as HTMLElement).style.transform = 'scale(1.02)'; (e.target as HTMLElement).style.boxShadow = 'var(--shadow-button-hover)'; }}
    />
  );
}

export function BtnSecondary(props: { disabled?: boolean; onClick?: () => void; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <button {...btnBase({ ...props, type: 'button' })}
      style={{
        padding: '9px 18px',
        borderRadius: 'var(--radius-md)',
        background: 'transparent',
        color: 'var(--muted)',
        border: '1px solid var(--border)',
        fontSize: 13,
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        (e.target as HTMLElement).style.color = 'var(--accent)';
        (e.target as HTMLElement).style.borderColor = 'var(--accent)';
        (e.target as HTMLElement).style.background = 'var(--accent-dim)';
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.color = 'var(--muted)';
        (e.target as HTMLElement).style.borderColor = 'var(--border)';
        (e.target as HTMLElement).style.background = 'transparent';
      }}
    />
  );
}

export function BtnDanger(props: { disabled?: boolean; onClick?: () => void; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <button {...btnBase({ ...props, type: 'button' })}
      style={{
        padding: '9px 18px',
        borderRadius: 'var(--radius-md)',
        background: 'transparent',
        color: 'var(--danger)',
        border: '1px solid var(--danger)',
        fontSize: 13,
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        (e.target as HTMLElement).style.background = 'var(--danger)';
        (e.target as HTMLElement).style.color = '#fff';
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.background = 'transparent';
        (e.target as HTMLElement).style.color = 'var(--danger)';
      }}
    />
  );
}

// ===== SettingBlock 设置页分组容器 =====
export function SettingBlock({ label, desc, saved, children }: { label: string; desc: string; saved?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div className="setting-group-label">{label}</div>
      <p style={{ fontSize: 11, color: 'var(--muted-soft)', fontFamily: 'var(--font-body)', marginBottom: 8 }}>{desc}</p>
      {children}
      {saved && (
        <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-body)', marginLeft: 8 }}>已保存</span>
      )}
    </div>
  );
}

// ===== FormInput (focus 光环效果) =====
export function FormInput({ value, onChange, placeholder, type = 'text', disabled, rows, style: extraStyle, ...rest }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  rows?: number;
  style?: React.CSSProperties;
} & React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>) {
  const Tag = rows ? 'textarea' : 'input';
  return (
    <Tag
      {...rest as any}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      style={{
        display: 'block',
        width: '100%',
        padding: '10px 14px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--fg)',
        fontSize: 14,
        lineHeight: 1.6,
        fontFamily: 'var(--font-body)',
        transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
        outline: 'none',
        resize: rows ? 'vertical' : 'none',
        ...extraStyle,
      }}
      onFocus={(e) => {
        (e.target as HTMLElement).style.borderColor = 'var(--accent)';
        (e.target as HTMLElement).style.boxShadow = '0 0 0 3px rgba(85,112,184,0.06)';
        (e.target as HTMLElement).style.background = '#fff';
      }}
      onBlur={(e) => {
        (e.target as HTMLElement).style.borderColor = 'var(--border)';
        (e.target as HTMLElement).style.boxShadow = 'none';
        (e.target as HTMLElement).style.background = 'var(--surface)';
      }}
    />
  );
}

// ===== ModalShell (520px 弹窗壳) =====
export function ModalShell({ onClose, children, width }: { onClose: () => void; children: React.ReactNode; width?: number }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(50, 58, 85, 0.4)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 0.2s',
      }}
    >
      <div
        style={{
          width: width || 520,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-xl)',
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-modal)',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(-12px)',
          transition: 'opacity 0.25s, transform 0.25s',
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ===== GearMenu 下拉菜单 =====
export function GearMenu({ x, y, onClose, children }: { x?: number; y?: number; onClose: () => void; children: React.ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    // 延迟绑定，避免触发 click 的同一次事件
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        zIndex: 200,
        minWidth: 160,
        padding: 4,
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-dropdown)',
        ...(x !== undefined ? { left: x, top: y } : { right: 0, top: '100%', marginTop: 4 }),
      }}
    >
      {children}
    </div>
  );
}

export function GearMenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        fontWeight: 500,
        color: danger ? 'var(--danger)' : 'var(--fg)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => {
        if (danger) {
          (e.target as HTMLElement).style.background = 'rgba(212, 96, 106, 0.1)';
        } else {
          (e.target as HTMLElement).style.background = 'var(--accent-dim)';
          (e.target as HTMLElement).style.color = 'var(--accent)';
        }
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.background = 'transparent';
        (e.target as HTMLElement).style.color = danger ? 'var(--danger)' : 'var(--fg)';
      }}
    >
      {children}
    </button>
  );
}
