// 工具调用分发器：接收 LLM 工具调用，分发到对应的服务执行

import { knowledgeService } from './KnowledgeService.js';
import { memoryRetrievalService } from './MemoryRetrievalService.js';
import { webSearchService } from './WebSearchService.js';

export class ToolExecutor {
  // 规范化查询参数：兼容旧的单 query 和新的 queries 数组，兜底使用用户原始消息
  private normalizeQueries(args: Record<string, any>, fallbackQuery?: string): string[] {
    if (Array.isArray(args.queries) && args.queries.length > 0) return args.queries;
    if (typeof args.query === 'string' && args.query.trim()) return [args.query.trim()];
    if (fallbackQuery && fallbackQuery.trim()) return [fallbackQuery.trim()];
    return [];
  }

  async execute(toolName: string, args: Record<string, any>, fallbackQuery?: string): Promise<any> {
    switch (toolName) {
      case 'search_memory': {
        const queries = this.normalizeQueries(args, fallbackQuery);
        if (queries.length === 0) return [];
        const limit = args.limit ?? 5;
        const allResults = await Promise.all(queries.map(q =>
          memoryRetrievalService.searchMemory(q, limit)
        ));
        // 按 memory_id 去重，保留首次出现的结果
        const seen = new Map<string, any>();
        for (const results of allResults) {
          for (const r of results) {
            if (!seen.has(r.memory_id)) seen.set(r.memory_id, r);
          }
        }
        return [...seen.values()].slice(0, limit);
      }
      case 'recall_context':
        return memoryRetrievalService.recallContext(args.memory_id);
      case 'recall_sources':
        return memoryRetrievalService.recallSources(args.memory_id, args.source_ids);
      case 'web_search': {
        const queries = this.normalizeQueries(args, fallbackQuery);
        if (queries.length === 0) return { raw: [], formatted: '', citations: [] };
        const maxResults = args.max_results ?? 5;
        const timeRange = args.time_range || 'NoLimit';
        // 并行搜索所有 query
        const allResults = await Promise.all(queries.map(query =>
          webSearchService.search({ query, maxResults, timeRange })
        ));
        // 按 url 去重，合并格式化引用
        const seen = new Map<string, any>();
        for (const results of allResults) {
          for (const r of results) {
            if (!seen.has(r.url)) seen.set(r.url, r);
          }
        }
        const merged = [...seen.values()].slice(0, maxResults * queries.length);
        const citationData = webSearchService.formatCitations(merged);
        return {
          raw: merged,
          formatted: citationData.formatted,
          citations: citationData.citations,
        };
      }
      case 'web_fetch':
        return webSearchService.fetchPage(args.url, args.mode || 'basic');
      case 'search_knowledge': {
        const queries = this.normalizeQueries(args, fallbackQuery);
        if (queries.length === 0) return [];
        const limit = args.limit ?? 5;
        const allResults = await Promise.all(queries.map(q =>
          knowledgeService.searchKnowledge(q, limit)
        ));
        // 按 chunk_id 去重
        const seen = new Map<string, any>();
        for (const results of allResults) {
          for (const r of results) {
            if (!seen.has(r.chunk_id)) seen.set(r.chunk_id, r);
          }
        }
        return [...seen.values()].slice(0, limit);
      }
      default:
        return { error: `未知工具: ${toolName}` };
    }
  }
}

export const toolExecutor = new ToolExecutor();
