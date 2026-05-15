// 工具调用块渲染组件：在助手消息中展示工具调用的状态和结果
// 支持展开查看搜索结果详情

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';

interface ToolCallEntry {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'done' | 'error';
  startedAt?: string;
  completedAt?: string;
}

const TOOL_DISPLAY_CONFIG: Record<string, {
  icon: string;
  colorClass: string;
  runningText: string;
  doneText: (result: any) => string;
}> = {
  search_memory: {
    icon: '🧠',
    colorClass: 'tool-purple',
    runningText: '搜索记忆中...',
    doneText: (r: any) => {
      const count = Array.isArray(r) ? r.length : r?.count ?? 0;
      return `搜索到 ${count} 条相关记忆`;
    },
  },
  recall_context: {
    icon: '💬',
    colorClass: 'tool-blue',
    runningText: '读取原始对话...',
    doneText: (r: any) => {
      const count = r?.turns?.length || 0;
      return `读取了 ${count} 轮原始对话`;
    },
  },
  recall_sources: {
    icon: '📎',
    colorClass: 'tool-indigo',
    runningText: '读取附件/网页...',
    doneText: (r: any) => {
      const count = (r?.attachments?.length || 0) + (r?.webRetrievals?.length || 0);
      return `读取了 ${count} 个来源`;
    },
  },
  web_search: {
    icon: '🌐',
    colorClass: 'tool-green',
    runningText: '搜索网页中...',
    doneText: (r: any) => {
      const items = Array.isArray(r?.raw) ? r.raw : (Array.isArray(r?.citations) ? r.citations : []);
      const count = items.length;
      return `搜索到 ${count} 条网页结果`;
    },
  },
  web_fetch: {
    icon: '📄',
    colorClass: 'tool-teal',
    runningText: '读取网页中...',
    doneText: (r: any) => {
      return `读取了 ${r?.title || '网页全文'}`;
    },
  },
};

function computeDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// 渲染 web_search 结果详情
function WebSearchDetail({ result }: { result: any }) {
  const citations = result?.citations || result?.raw || [];
  if (!Array.isArray(citations) || citations.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {citations.map((c: any) => (
        <div key={c.id || c.title} className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--border-soft)' }}>
          <div className="flex items-start gap-1.5">
            <span className="flex-shrink-0 rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: 'var(--success)' }}>{c.id || ''}</span>
            <div className="flex-1 min-w-0">
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--fg)' }}>
                {c.title}
              </a>
              {c.snippet && (
                <p className="mt-0.5 leading-relaxed opacity-70" style={{ color: 'var(--muted)' }}>
                  {c.snippet.length > 200 ? c.snippet.slice(0, 200) + '...' : c.snippet}
                </p>
              )}
            </div>
            {c.url && (
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 opacity-50 hover:opacity-100" title="打开链接">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// 渲染 search_memory 结果详情
function MemorySearchDetail({ result }: { result: any }) {
  const memories = Array.isArray(result) ? result : result?.memories || [];
  if (!Array.isArray(memories) || memories.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {memories.map((m: any, idx: number) => (
        <div key={m.id || idx} className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--border-soft)' }}>
          <div className="font-medium" style={{ color: 'var(--fg)' }}>{m.content || m.title || m.name}</div>
          {m.score !== undefined && (
            <span className="text-[10px] opacity-50" style={{ color: 'var(--muted-soft)' }}>
              相似度: {(Number(m.score) * 100).toFixed(0)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ToolCallBlock({ toolCall, depth = 0 }: { toolCall: ToolCallEntry; depth?: number }) {
  const config = TOOL_DISPLAY_CONFIG[toolCall.toolName];
  const [expanded, setExpanded] = useState(false);
  if (!config) return null;

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending';
  const isDone = toolCall.status === 'done';
  const dur = computeDuration(toolCall.startedAt, toolCall.completedAt);
  const queryArg = toolCall.args?.query as string | undefined;
  const memoryArg = toolCall.args?.memory_id as string | undefined;
  const urlArg = toolCall.args?.url as string | undefined;
  const hasDetail = isDone && toolCall.result != null;

  // 缩进连接线
  const indentPx = depth * 20;

  return (
    <div className={cn('tool-call-block py-1 text-xs', config.colorClass)} style={{ paddingLeft: indentPx }}>
      <div
        className={cn('flex items-start gap-2', hasDetail && 'cursor-pointer hover:opacity-80')}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {depth > 0 && <span className="text-[10px] opacity-40 select-none" style={{ marginLeft: -8 }}>├─</span>}
        <span className="flex-shrink-0 mt-0.5">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <span className="font-medium">{isRunning ? config.runningText : config.doneText(toolCall.result)}</span>
          {queryArg && !isRunning && (
            <span className="opacity-60 ml-1">: "{queryArg}"</span>
          )}
          {memoryArg && !isRunning && (
            <span className="opacity-60 ml-1">: {memoryArg.slice(0, 12)}</span>
          )}
          {urlArg && !isRunning && (
            <span className="opacity-60 ml-1">: {urlArg.slice(0, 50)}</span>
          )}
          {dur && (
            <span className="opacity-40 ml-2">{dur}</span>
          )}
          {hasDetail && (
            <span className="inline-flex items-center ml-1.5" style={{ color: 'var(--accent)' }}>
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          )}
        </div>
      </div>

      {/* 搜索结果详情 */}
      {expanded && hasDetail && (
        <>
          {toolCall.toolName === 'web_search' && <WebSearchDetail result={toolCall.result} />}
          {toolCall.toolName === 'search_memory' && <MemorySearchDetail result={toolCall.result} />}
          {toolCall.toolName === 'web_fetch' && (
            <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--border-soft)' }}>
              <div className="font-medium" style={{ color: 'var(--fg)' }}>
                {(toolCall.result as any)?.title || '网页'}
              </div>
              <div className="mt-1 leading-relaxed whitespace-pre-wrap opacity-70 max-h-40 overflow-y-auto" style={{ color: 'var(--muted)' }}>
                {typeof (toolCall.result as any)?.content === 'string' ? (toolCall.result as any).content.slice(0, 1000) : ''}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export { TOOL_DISPLAY_CONFIG };
