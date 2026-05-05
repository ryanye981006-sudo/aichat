// 引用来源展示组件：可折叠展示 RAG 检索引用的文档片段
import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Citation {
  documentName: string;
  score: number;
  snippet: string;
  metadata: {
    embedding_model_name?: string;
    embedding_dimension?: number;
    chunk_strategy?: string;
    chunk_size?: number;
    chunk_overlap?: number;
  } | null;
}

interface CitationBlockProps {
  citations: Citation[];
}

export default function CitationBlock({ citations }: CitationBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="rounded-lg border text-xs" style={{
      borderColor: 'var(--color-border)',
      backgroundColor: 'var(--color-background-soft)',
    }}>
      {/* 折叠标题栏 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:opacity-80 transition-opacity"
        style={{ color: 'var(--color-text-2)' }}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <FileText className="w-3.5 h-3.5" />
          参考了 {citations.length} 个来源
        </span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5" />
          : <ChevronDown className="w-3.5 h-3.5" />
        }
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 border-t" style={{ borderColor: 'var(--color-border)' }}>
          {citations.map((c, i) => (
            <div key={i} className="py-1.5">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {c.documentName}
                </span>
                <span className="shrink-0 opacity-60" style={{ color: 'var(--color-primary)' }}>
                  {(c.score * 100).toFixed(0)}%
                </span>
              </div>
              <div className="leading-relaxed opacity-70 line-clamp-3" style={{ color: 'var(--color-text-2)' }}>
                {c.snippet}{c.snippet.length >= 100 ? '...' : ''}
              </div>
              {/* 元数据行：嵌入模型、分块策略 */}
              {c.metadata && (
                <div className="flex gap-3 mt-1 opacity-50" style={{ color: 'var(--color-text-3)' }}>
                  {c.metadata.embedding_model_name && (
                    <span>模型: {c.metadata.embedding_model_name}</span>
                  )}
                  {c.metadata.chunk_strategy && (
                    <span>策略: {c.metadata.chunk_strategy}</span>
                  )}
                  {c.metadata.chunk_size && (
                    <span>分块: {c.metadata.chunk_size}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
