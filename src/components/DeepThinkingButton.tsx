// 深度思考按钮：二态强制开关，点击开启/关闭

import { BrainCircuit } from 'lucide-react';
import { cn } from '../lib/utils';

interface DeepThinkingButtonProps {
  mode: boolean;
  onChange: (enabled: boolean) => void;
  visible: boolean;
}

export default function DeepThinkingButton({ mode, onChange, visible }: DeepThinkingButtonProps) {
  if (!visible) return null;

  const enabled = mode;

  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border',
        enabled && 'ring-1'
      )}
      style={{
        borderColor: enabled ? '#3b82f6' : 'var(--color-border)',
        color: enabled ? '#3b82f6' : 'var(--color-text-2)',
        backgroundColor: enabled ? 'rgba(59,130,246,0.08)' : 'transparent',
      }}
    >
      <BrainCircuit className="w-3 h-3" />
      {enabled ? '深度思考' : '不思考'}
    </button>
  );
}
