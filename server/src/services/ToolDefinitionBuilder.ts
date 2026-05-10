// 构建 search_memory / recall_context / recall_sources 三个记忆工具
// 使用 Zod schema 定义，供 AiSdkService 注入 tools 参数

import { z } from 'zod';

export class ToolDefinitionBuilder {
  buildTools(memoryEnabled: boolean): Record<string, any> | undefined {
    if (!memoryEnabled) return undefined;

    return {
      search_memory: {
        description: '搜索用户的长期记忆，获取之前对话中记录的事实、偏好和上下文。当你不确定用户是否提到过某个信息时，使用此工具搜索。',
        inputSchema: z.object({
          query: z.string().describe('搜索关键词，用自然语言写检索词'),
          limit: z.number().optional().default(5).describe('返回条数，默认 5'),
        }),
      },
      recall_context: {
        description: '获取指定记忆的原始对话上下文，了解记忆的来源和背景。返回原始对话原文和关联的附件/网页列表（仅名称和类型）。当你需要了解某条记忆的具体来源时使用。',
        inputSchema: z.object({
          memory_id: z.string().describe('记忆 ID，来自 search_memory 返回的 memory_id'),
        }),
      },
      recall_sources: {
        description: '获取指定记忆关联的附件全文和网页检索内容。返回附件内容全文和网页检索摘要。当你需要查看具体文件内容或网页检索结果时使用。注意：此操作可能返回大量文本。',
        inputSchema: z.object({
          memory_id: z.string().describe('记忆 ID'),
          source_ids: z.array(z.string()).optional().describe('指定要获取的 source ID 列表，不传则返回全部'),
        }),
      },
    };
  }
}

export const toolDefinitionBuilder = new ToolDefinitionBuilder();
