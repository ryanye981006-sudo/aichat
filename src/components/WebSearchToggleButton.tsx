// 联网搜索开关按钮：二态切换

import { Globe } from 'lucide-react';
import { cn } from '../lib/utils';

interface WebSearchToggleButtonProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export default function WebSearchToggleButton({ enabled, onChange }: WebSearchToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border',
        enabled && 'ring-1'
      )}
      style={{
        borderColor: enabled ? '#16a34a' : 'var(--color-border)',
        color: enabled ? '#16a34a' : 'var(--color-text-2)',
        backgroundColor: enabled ? 'rgba(22,163,74,0.08)' : 'transparent',
      }}
    >
      <Globe className="w-3 h-3" />
      联网
    </button>
  );
}
