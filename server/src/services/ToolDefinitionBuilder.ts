// 构建所有 LLM 工具定义（记忆工具 + 网页搜索工具）
// 使用 Zod schema 定义，供 AiSdkService 注入 tools 参数

import { z } from 'zod';

export interface ToolsConfig {
  memoryEnabled: boolean;
  webSearchEnabled: boolean;
  knowledgeEnabled: boolean;
}

export class ToolDefinitionBuilder {
  buildTools(opts: ToolsConfig): Record<string, any> | undefined {
    const { memoryEnabled, webSearchEnabled, knowledgeEnabled } = opts;
    const tools: Record<string, any> = {};

    if (memoryEnabled) {
      tools.search_memory = {
        description: '搜索用户的长期记忆，获取之前对话中记录的事实、偏好和上下文。当你不确定用户是否提到过某个信息时，使用此工具搜索。可以一次提供多个查询角度并行检索。',
        parameters: z.object({
          queries: z.array(z.string()).describe('搜索关键词列表，每个是自然语言检索词。可以给 1-3 个不同角度的查询，例如 ["用户偏好", "杭州旅游", "出行计划"]'),
          limit: z.number().optional().default(5).describe('返回条数，默认 5'),
        }),
      };
      tools.recall_context = {
        description: '获取指定记忆的原始对话上下文，了解记忆的来源和背景。返回原始对话原文和关联的附件/网页列表（仅名称和类型）。当你需要了解某条记忆的具体来源时使用。',
        parameters: z.object({
          memory_id: z.string().describe('记忆 ID，来自 search_memory 返回的 memory_id'),
        }),
      };
      tools.recall_sources = {
        description: '获取指定记忆关联的附件全文和网页检索内容。返回附件内容全文和网页检索摘要。当你需要查看具体文件内容或网页检索结果时使用。注意：此操作可能返回大量文本。',
        parameters: z.object({
          memory_id: z.string().describe('记忆 ID'),
          source_ids: z.array(z.string()).optional().describe('指定要获取的 source ID 列表，不传则返回全部'),
        }),
      };
    }

    if (knowledgeEnabled) {
      tools.search_knowledge = {
        description: '搜索知识库中的文档内容。知识库中包含用户上传的 PDF、Word、TXT、Markdown 等参考文档。当用户询问关于已上传文档的内容、需要引用文档中的信息、或提到"之前上传的文件""文档里说"等时使用此工具搜索。可以一次提供多个查询角度并行检索。',
        parameters: z.object({
          queries: z.array(z.string()).describe('搜索关键词列表，每个是自然语言检索词。建议 1-3 个不同角度的查询以提升召回率'),
          limit: z.number().optional().default(5).describe('返回条数，默认 5'),
        }),
      };
    }

    if (webSearchEnabled) {
      tools.web_search = {
        description: '搜索互联网，获取最新信息、事实、数据。当你不确定某个事实、需要最新信息、或用户明确要求上网查时使用。可以一次提供多个查询角度并行检索。',
        parameters: z.object({
          queries: z.array(z.string()).describe('检索关键词列表。可以给 1-3 个不同角度的查询，例如 ["杭州天气 2026-05", "杭州旅游攻略", "宋城门票"]'),
          max_results: z.number().optional().default(5).describe('每个查询返回条数，默认 5，最大 10'),
          time_range: z.enum(['NoLimit', 'OneDay', 'OneWeek', 'OneMonth', 'OneYear']).optional().default('NoLimit').describe('时间范围'),
        }),
      };
      tools.web_fetch = {
        description: '读取指定网页的完整内容。当你需要从搜索结果中获取详细信息时使用。注意：此操作可能返回大量文本。',
        parameters: z.object({
          url: z.string().describe('要读取的网页 URL'),
          mode: z.enum(['basic', 'scrape']).optional().default('basic').describe('抓取模式：basic=静态解析，scrape=JS渲染'),
        }),
      };
    }

    return Object.keys(tools).length > 0 ? tools : undefined;
  }
}

export const toolDefinitionBuilder = new ToolDefinitionBuilder();
