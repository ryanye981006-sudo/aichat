// 深度思考三态按钮：auto → enabled → disabled → auto 循环

import { BrainCircuit, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';

interface DeepThinkingButtonProps {
  mode: 'auto' | 'enabled' | 'disabled';
  onChange: (mode: 'auto' | 'enabled' | 'disabled') => void;
  visible: boolean;
}

const options = [
  { value: 'auto' as const, label: '自动' },
  { value: 'enabled' as const, label: '深度思考' },
  { value: 'disabled' as const, label: '不思考' },
];

export default function DeepThinkingButton({ mode, onChange, visible }: DeepThinkingButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!visible) return null;

  const current = options.find(o => o.value === mode) || options[0];
  const isActive = mode !== 'auto';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border',
          isActive && 'ring-1'
        )}
        style={{
          borderColor: isActive ? '#3b82f6' : 'var(--color-border)',
          color: isActive ? '#3b82f6' : 'var(--color-text-2)',
          backgroundColor: isActive ? 'rgba(59,130,246,0.08)' : 'transparent',
        }}
      >
        <BrainCircuit className="w-3 h-3" />
        {current.label}
        <ChevronDown className="w-3 h-3" />
      </button>
      {showDropdown && (
        <div className="absolute bottom-full left-0 mb-1.5 rounded-xl border shadow-lg py-1 z-50 min-w-[200px]"
          style={{
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)',
          }}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => { onChange(option.value); setShowDropdown(false); }}
              className="w-full text-left px-4 py-2.5 hover:bg-black/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{option.label}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
                    {option.value === 'auto' ? '跟随助手设置' : option.value === 'enabled' ? '强制开启深度思考' : '强制关闭深度思考'}
                  </div>
                </div>
                {mode === option.value && (
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
