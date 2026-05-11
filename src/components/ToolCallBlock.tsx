// 工具调用块渲染组件：在助手消息中展示工具调用的状态和结果

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
      const items = Array.isArray(r) ? r : (r?.raw || r?.citations);
      const count = Array.isArray(items) ? items.length : 0;
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

export default function ToolCallBlock({ toolCall, depth = 0 }: { toolCall: ToolCallEntry; depth?: number }) {
  const config = TOOL_DISPLAY_CONFIG[toolCall.toolName];
  if (!config) return null;

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending';
  const dur = computeDuration(toolCall.startedAt, toolCall.completedAt);
  const queryArg = toolCall.args?.query as string | undefined;
  const memoryArg = toolCall.args?.memory_id as string | undefined;
  const urlArg = toolCall.args?.url as string | undefined;

  // 缩进连接线
  const indentPx = depth * 20;

  return (
    <div
      className={cn('tool-call-block flex items-start gap-2 py-1 text-xs', config.colorClass)}
      style={{ paddingLeft: indentPx }}
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
      </div>
    </div>
  );
}

export { TOOL_DISPLAY_CONFIG };
