// 构建所有 LLM 工具定义（记忆工具 + 网页搜索工具）
// 使用 Zod schema 定义，供 AiSdkService 注入 tools 参数

import { z } from 'zod';

export interface ToolsConfig {
  memoryEnabled: boolean;
  webSearchEnabled: boolean;
}

export class ToolDefinitionBuilder {
  buildTools(opts: ToolsConfig): Record<string, any> | undefined {
    const { memoryEnabled, webSearchEnabled } = opts;
    const tools: Record<string, any> = {};

    if (memoryEnabled) {
      tools.search_memory = {
        description: '搜索用户的长期记忆，获取之前对话中记录的事实、偏好和上下文。当你不确定用户是否提到过某个信息时，使用此工具搜索。',
        inputSchema: z.object({
          query: z.string().describe('搜索关键词，用自然语言写检索词'),
          limit: z.number().optional().default(5).describe('返回条数，默认 5'),
        }),
      };
      tools.recall_context = {
        description: '获取指定记忆的原始对话上下文，了解记忆的来源和背景。返回原始对话原文和关联的附件/网页列表（仅名称和类型）。当你需要了解某条记忆的具体来源时使用。',
        inputSchema: z.object({
          memory_id: z.string().describe('记忆 ID，来自 search_memory 返回的 memory_id'),
        }),
      };
      tools.recall_sources = {
        description: '获取指定记忆关联的附件全文和网页检索内容。返回附件内容全文和网页检索摘要。当你需要查看具体文件内容或网页检索结果时使用。注意：此操作可能返回大量文本。',
        inputSchema: z.object({
          memory_id: z.string().describe('记忆 ID'),
          source_ids: z.array(z.string()).optional().describe('指定要获取的 source ID 列表，不传则返回全部'),
        }),
      };
    }

    if (webSearchEnabled) {
      tools.web_search = {
        description: '搜索互联网，获取最新信息、事实、数据。当你不确定某个事实、需要最新信息、或用户明确要求上网查时使用。',
        inputSchema: z.object({
          query: z.string().describe('检索关键词（模型根据用户问题提炼）'),
          max_results: z.number().optional().default(5).describe('返回条数，默认 5，最大 10'),
          time_range: z.enum(['NoLimit', 'OneDay', 'OneWeek', 'OneMonth', 'OneYear']).optional().default('NoLimit').describe('时间范围'),
        }),
      };
      tools.web_fetch = {
        description: '读取指定网页的完整内容。当你需要从搜索结果中获取详细信息时使用。注意：此操作可能返回大量文本。',
        inputSchema: z.object({
          url: z.string().describe('要读取的网页 URL'),
          mode: z.enum(['basic', 'scrape']).optional().default('basic').describe('抓取模式：basic=静态解析，scrape=JS渲染'),
        }),
      };
    }

    return Object.keys(tools).length > 0 ? tools : undefined;
  }
}

export const toolDefinitionBuilder = new ToolDefinitionBuilder();
