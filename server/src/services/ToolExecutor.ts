// 工具调用分发器：接收 LLM 工具调用，分发到对应的服务执行

import { memoryRetrievalService } from './MemoryRetrievalService.js';
import { webSearchService } from './WebSearchService.js';

export class ToolExecutor {
  async execute(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'search_memory':
        return memoryRetrievalService.searchMemory(args.query, args.limit ?? 5);
      case 'recall_context':
        return memoryRetrievalService.recallContext(args.memory_id);
      case 'recall_sources':
        return memoryRetrievalService.recallSources(args.memory_id, args.source_ids);
      case 'web_search': {
        const results = await webSearchService.search({
          query: args.query,
          maxResults: args.max_results ?? 5,
          timeRange: args.time_range || 'NoLimit',
        });
        const citationData = webSearchService.formatCitations(results);
        return {
          raw: results,
          formatted: citationData.formatted,
          citations: citationData.citations,
        };
      }
      case 'web_fetch':
        return webSearchService.fetchPage(args.url, args.mode || 'basic');
      default:
        return { error: `未知工具: ${toolName}` };
    }
  }
}

export const toolExecutor = new ToolExecutor();
