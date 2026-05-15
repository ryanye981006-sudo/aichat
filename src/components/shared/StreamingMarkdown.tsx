import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export default function StreamingMarkdown({ content, isStreaming, className }: StreamingMarkdownProps) {
  return (
    <div className={cn(
      'prose prose-sm md:prose-base max-w-none',
      className
    )}>
      <style>{`
        .prose {
          color: var(--fg);
          line-height: 1.75;
        }
        .prose p { margin-bottom: 0.75rem; }
        .prose p:last-child { margin-bottom: 0; }
        .prose h1, .prose h2, .prose h3 { color: var(--fg); margin-top: 1.25rem; margin-bottom: 0.5rem; }
        .prose ul { list-style: disc; padding-left: 1.5rem; margin-bottom: 0.75rem; }
        .prose ol { list-style: decimal; padding-left: 1.5rem; margin-bottom: 0.75rem; }
        .prose li { margin-bottom: 0.25rem; }
        .prose a { color: var(--accent); }
        .prose blockquote {
          border-left: 3px solid var(--border);
          padding-left: 1rem;
          color: var(--muted);
          margin: 0.75rem 0;
        }
        .prose code {
          font-family: var(--font-mono);
          background: var(--color-inline-code-background);
          color: var(--color-inline-code-text);
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
          font-size: 0.875em;
        }
        .prose pre {
          background: var(--color-code-background);
          padding: 1rem;
          border-radius: 8px;
          overflow-x: auto;
          margin: 0.75rem 0;
        }
        .prose pre code {
          background: transparent;
          color: var(--fg);
          padding: 0;
        }
        .prose table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.75rem 0;
        }
        .prose th, .prose td {
          border: 1px solid var(--border);
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .prose th {
          background: var(--chat-bg);
          font-weight: 600;
        }
      `}</style>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content || (isStreaming ? '' : '...')}
      </ReactMarkdown>
    </div>
  );
}
