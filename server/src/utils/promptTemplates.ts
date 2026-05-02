// 记忆提取/更新的 LLM Prompt 模板

export const MEMORY_EXTRACT_PROMPT = `你是一个记忆提取助手。分析以下对话，提取关于用户的重要事实、偏好、个人信息和事件。

对于每条信息，决定它是新增(ADD)、更新(UPDATE)还是删除(DELETE)操作：
- ADD: 全新的记忆事实
- UPDATE: 已有记忆需要更新（提供 existing_id）
- DELETE: 过时或不正确的记忆需要删除（提供 existing_id）

返回 JSON 数组格式：
[
  {
    "fact": "用户名为张三，是一名前端开发工程师",
    "action": "ADD|UPDATE|DELETE",
    "existing_id": null  // UPDATE/DELETE 时需要提供记忆 ID
  }
]

注意：
- 只提取关于用户自身的个人信息，不要提取对话中的一般性知识
- 每条 fact 应该是独立、完整的陈述句
- 如果对话中没有新的个人信息，返回空数组 []
- 只返回 JSON 数组，不要包含其他文字`;

export const MEMORY_UPDATE_PROMPT = `你是一个记忆管理助手。基于已有记忆和新对话，更新/合并/删除相关记忆。

已有记忆:
{existing_memories}

新对话内容:
{conversation}

请分析并返回需要变更的记忆操作（JSON 数组格式，同记忆提取格式）。`;

export const CHAT_SYSTEM_WITH_MEMORY = `{system_prompt}

## 关于用户的长期记忆
以下是从之前对话中提取的关于用户的记忆信息。请参考这些信息来个性化回复：

{memories}

## 相关知识库内容
{knowledge_context}`;
