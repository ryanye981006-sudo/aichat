import { useState, type ReactNode } from 'react';
import { BrainCircuit, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ThinkBlockProps {
  content?: string;
  children?: ReactNode;
}

export default function ThinkBlock({ content, children }: ThinkBlockProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border overflow-hidden" style={{
      borderColor: 'var(--color-border)',
      backgroundColor: 'var(--color-background-soft)',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
        style={{ color: 'var(--color-text-2)' }}
      >
        <BrainCircuit className="w-4 h-4" />
        <span>深度思考过程</span>
        <span className="flex-1" />
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 text-sm leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
          {children || <span className="whitespace-pre-wrap">{content}</span>}
        </div>
      )}
    </div>
  );
}
