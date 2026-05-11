# 个人聊天项目长期记忆方案分析

> 探索 GitHub 上做长期记忆比较好的个人聊天项目及底层记忆引擎
> 撰写日期：2026-05-09

---

## 一、核心结论

个人聊天场景的长期记忆与 Claude Code 这种工具型 Agent 有本质区别：

| 维度 | 工具型 Agent (Claude Code) | 个人聊天 |
|------|--------------------------|---------|
| 记忆内容 | 工具输出、文件内容、决策路径 | 用户偏好、生活事件、情感倾向、知识积累 |
| 衰减特征 | 工具输出快速贬值（文件被修改） | 偏好缓慢演变、事件有明确时效性 |
| 检索方式 | 时间+FIFO 裁剪，LLM 摘要 | 语义搜索 + 时间衰减 + 关系推理 |
| 存储粒度 | 对话轮次 | 用户事实/偏好/事件/知识片段 |
| 多会话 | 工作树隔离 | 同一用户跨会话聚合 |

**因此 Claude Code 那套 Snip/Microcompact 管线不适合直接用于聊天项目。** 聊天场景需要的是"理解用户是谁、记得用户说过什么"的能力，而不是"丢掉过期的工具输出"。

---

## 二、成熟聊天应用方案（带长期记忆的 Chat UI）

### 2.1 Open WebUI — 最推荐参考

| 维度 | 详情 |
|------|------|
| **仓库** | `open-webui/open-webui` |
| **Stars** | ~135k |
| **License** | MIT |
| **技术栈** | Python 后端 + Svelte/TypeScript 前端 |
| **最新版本** | v0.9.2 (2026) |

**记忆相关能力：**

- **Adaptive Memory（内置，2024 年底）**：自动跨会话记住用户的关键信息，无需手动触发。"我上次聊到哪儿了？"这种查询可以直接回答
- **RAG 知识库**：支持 9 种向量数据库（ChromaDB、Qdrant、PGVector、Milvus 等），PDF/Word/Markdown 文件上传后语义检索注入
- **跨会话召回（v0.7.0，2026.1）**：用户可以问"我上周聊的 X 项目怎么样了？"直接搜索历史
- **社区记忆函数**：
  - `open-webui-memory`（ronilaukkarinen）：自动识别事实/偏好、去重、冲突合并，类似 ChatGPT 的记忆功能
  - "Super Memory"中文优化版：带时间戳记忆、后台摘要、智能事实更新
- **记忆改进 Issue #13993**：社区正在做每条消息检索 top-K 相关记忆（不是只取一条），改进 system prompt 用法

**架构特点：**
- 记忆存储与向量数据库解耦，可插拔
- Memory 开关支持全局/用户/分组级别控制
- 完全自托管，数据不出本地

### 2.2 LobeChat — 插件生态最强

| 维度 | 详情 |
|------|------|
| **仓库** | `lobehub/lobe-chat` |
| **Stars** | ~70k+ |
| **License** | Apache 2.0 |
| **技术栈** | Next.js / TypeScript |

**记忆相关能力：**

- **内置 RAG 知识库**：pgvector 语义搜索，支持文件/图片/音频/视频上传
- **会话内记忆**：`internal_summaryHistory` 主题摘要，会话内上下文管理做得很好
- **跨会话记忆（规划中）**：
  - Issue #9654 "Global Conversation Memory" 是呼声最高的 feature request
  - 数据库 `user_memories` 表已建好，`chatMemory` action 已就位
  - 方案：每个会话结束后自动提取记忆 → 向量化存储 → 新会话注入相关记忆 → 前端管理 UI
  - Issue #10231 提议集成 **Cognee** 作为长期记忆插件
- **MCP Marketplace**：可通过 MCP 协议接入任意外部记忆服务

**架构特点：**
- 插件生态非常丰富，记忆层可通过插件实现
- DB schema 已经预留了 `user_memories` 表
- 40+ AI 供应商支持

### 2.3 NextChat — 轻量但无长期记忆

| 维度 | 详情 |
|------|------|
| **仓库** | `ChatGPTNextWeb/NextChat` |
| **Stars** | ~87.7k |
| **技术栈** | Next.js / React |
| **记忆能力** | 仅会话级 + 上下文压缩，无长期跨会话记忆 |

**结论：** 太轻量了，不适合作为记忆方案的参考。但它的**上下文压缩**（自动摘要历史节省 token）设计可以作为会话内上下文管理的参考。

---

## 三、专用记忆引擎（可嵌入聊天项目的底层方案）

### 3.1 方案全景对比

| 引擎 | LoCoMo 得分 | 存储架构 | 开源 | 部署 | 适合聊天 |
|------|-----------|---------|------|------|---------|
| **MemMachine** | **91.7%** | PG+pgvector + Neo4j 图数据库 | ✅ Apache 2.0 | Docker | ⭐⭐⭐⭐⭐ |
| EverMemOS | 92.3% | 类人脑 Engram 生命周期 | ❌ 闭源 | 论文阶段 | ⭐⭐⭐ |
| Zep | ~85% | 向量 + 知识图谱 | 部分 | 云/自托管 | ⭐⭐⭐⭐ |
| Letta/MemGPT | ~83.2% | 分层记忆 + LLM OS | ✅ | 自托管 | ⭐⭐⭐ |
| Mem0 | ~58-66% | 向量 + 图 + KV 三合一 | 部分(Open Core) | 云/自托管 | ⭐⭐⭐ |
| OpenMemory | N/A | Qdrant + PG + MCP | ✅ | Docker | ⭐⭐⭐⭐ |
| MemPalace | 96.6% R@5 | ChromaDB + Palace 分层 | ✅ | 本地 | ⭐⭐⭐ |

### 3.2 MemMachine — 最推荐（开源第一 + token 省 80%）

> 仓库：`memmachine/memmachine` | 论文：arxiv 2604.04853

**核心创新：保留原始对话 episode，不用 LLM 提取摘要。** 这是与 Mem0 最大的区别——Mem0 用 LLM 提取压缩会丢失信息，MemMachine 存完整对话回合。

```
架构：
┌─────────────────────────────────────────┐
│              MemMachine API             │
├─────────────────────────────────────────┤
│  短期记忆 (STM)      情节记忆 (Episodic) │
│  即时上下文          完整对话 → Neo4j    │
│                      ↕                  │
│  档案记忆 (Profile/Semantic) → SQL      │
├─────────────────────────────────────────┤
│  PostgreSQL+pgvector    Neo4j 图数据库   │
└─────────────────────────────────────────┘
```

**关键设计：**
- **情节记忆**：完整对话回合存入 Neo4j 图数据库，保留时间序列和因果关系
- **档案记忆**：提取长期事实/偏好到 SQL
- **上下文检索**：核匹配 + 相邻回合扩展（前 1 后 2），解决"迷失在中间"
- **自适应路由**：直接检索 / 并行分解 / 迭代链式查询，根据查询复杂度自动选
- **多租户隔离**：`producer`/`produced_for` 参数天然支持多用户
- **原生 MCP 支持**：可作为 MCP Server 供任意客户端调用

**为什么适合聊天项目：**
1. 存完整对话而非摘要 → 用户问"上次聊到哪儿了"能精确恢复上下文
2. 图数据库存储实体关系 → "我喜欢科幻 → 推荐诺兰电影"可做多跳推理
3. 80% 更少 token → 聊天场景频繁调用，成本优势明显
4. Docker Compose 一键部署 → 轻松嵌入现有项目
5. 开源 + Apache 2.0 → 无商业风险

### 3.3 Mem0 — 最成熟但过度设计

> 仓库：`mem0ai/mem0` | 37k+ Stars

```
架构：向量数据库 + 知识图谱 + 键值数据库（三合一混合存储）
```

**优点：** SDK 完善（Python/Node）、社区最大、文档最全
**缺点：**
- Open Core 模式，高级功能闭源
- 独立评测 LoCoMo 仅 58%，与其自报的 66% 有差距
- 云优先设计，本地部署体验不如 MemMachine
- 面向 Agent 场景设计，对聊天场景过度设计

### 3.4 OpenMemory — 跨客户端记忆共享

> Mem0 团队子项目，完全基于 MCP 协议

```
技术栈：FastAPI + Qdrant + PostgreSQL + Docker
```

**核心卖点：本地优先 + 跨客户端记忆同步。** 如果你用多个 AI 客户端（Claude Desktop、Cursor、Windsurf），记忆可以在各客户端之间共享。

**四大操作：** `add_memories` / `search_memory` / `list_memories` / `delete_all_memories`
**细粒度 ACL：** 按 App/User/Memory 维度控制访问权限

适合作为聊天项目的 MCP 记忆后端，但本身不是聊天应用。

---

## 四、社区实现案例（小型项目，可直接参考代码）

| 项目 | 仓库 | 核心特点 |
|------|------|---------|
| **MemoryGraph** | `Loul-Zaster/MemoryGraph` | LangGraph 6 节点工作流 + ChromaDB，4 种记忆类型（Facts 0.9 / Preferences 0.8 / Experiences 0.7 / Knowledge 0.6），按用户隔离 ChromaDB collection |
| **Mem0Chat** | `mzazakeith/Mem0Chat` | Next.js + Mem0，展示如何把 Mem0 嵌入聊天应用的完整示例 |
| **LastChat** | `Cocolalilal/LastChat` | Android 聊天 App，RAG 记忆系统，本地优先 + WebDAV 同步 |
| **Black-Cat** | `skye-flyhigh/black-cat` | 桌面宠物型，完全本地运行（Ollama + ChromaDB），去重存储 |
| **Memori** | `GibsonAI/memori` | "第二大脑" RAG 引擎，树莓派可跑（50MB RAM），时间衰减 + TTL，AES-256 加密 |
| **OpenMemory** (独立) | `OpenMemory` 组织 | 5 扇区记忆（episodic/semantic/procedural/emotional/reflective），记忆衰减曲线 + 强化，~110ms 检索 100k 节点 |
| **DiffMem** | `Growth-Kinetics/DiffMem` | Git 式记忆——Markdown + Git，不用向量数据库，grep/git log 做检索 |

---

## 五、推荐架构方案

针对 aichat 这类个人聊天项目，建议采用**三层记忆架构**：

```
┌──────────────────────────────────────────────────┐
│                   Chat API 层                     │
│          (消息收发、会话管理、用户认证)            │
└──────────────────────┬───────────────────────────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
┌─────────────┐ ┌─────────────┐ ┌──────────────┐
│  L0: 热层   │ │ L1: 温层    │ │ L2: 冷层     │
│  会话上下文  │ │  近期记忆    │ │  长期档案    │
├─────────────┤ ├─────────────┤ ├──────────────┤
│ 最近 N 条   │ │ 近 30 天    │ │ 永久存储     │
│ 消息        │ │ 对话提取的   │ │ 用户画像     │
│ (内存/Redis)│ │ 事实/偏好    │ │ 知识图谱     │
│             │ │ (pgvector)   │ │ (SQLite/PG)  │
├─────────────┤ ├─────────────┤ ├──────────────┤
│ 0 LLM 调用  │ │ 语义搜索     │ │ 结构化查询   │
│ 毫秒级      │ │ 百毫秒级     │ │ 毫秒级       │
└─────────────┘ └─────────────┘ └──────────────┘
       │               │                │
       └───────────────┼────────────────┘
                       ▼
              ┌─────────────────┐
              │  记忆提取 Agent  │
              │  (异步/定时)     │
              │  新会话结束触发   │
              │  提取事实/偏好    │
              │  去重 → 更新档案  │
              └─────────────────┘
```

### 各层详解

**L0 — 热层（会话上下文）**
- 最近 N 条消息（滑动窗口），直接拼到 system prompt
- 零额外成本，纯内存操作
- 会话切换时全部丢弃

**L1 — 温层（近期语义记忆）**
- 每个会话结束后，异步触发记忆提取 Agent
- 从对话中提取：事实陈述、偏好表达、重要事件、待办事项
- 存入 pgvector（向量 + 元数据），支持语义搜索
- 自动衰减：30 天未确认的记忆降低权重
- 每次新消息时，检索 top-K 相关记忆注入 system prompt

**L2 — 冷层（长期用户档案）**
- 定期（每天/每周）从温层合并稳定记忆到冷层
- 结构化存储：用户画像、知识积累、长期偏好
- 去重 + 冲突解决（详见下方关键设计决策第 5 点）
- 参考 MemMachine：保留原始对话链接，用户可回溯

### 关键设计决策

1. **提取 vs 存原文**：聊天场景建议混合——短期存原文（便于精确回溯），长期存提取后的事实（节省 token）。参考 MemMachine 的做法保留原始对话链接
2. **检索时机**：每次用户发消息时检索温层 + 冷层，而非每轮对话（减少 API 调用）
3. **用户隔离**：所有记忆按 `user_id` 隔离存储，参考 MemoryGraph 的 `user_{id}_session_{id}` collection 设计
4. **记忆衰减**：参考 ACT-R 模型（MemRosetta 的 Hot/Warm/Cold 分级），最近访问的加权、长期未用的降权
5. **去重与冲突解决**（核心机制，详解见下方）

### 去重与冲突解决机制详解

报告中"同 key 的记忆取最新的、LLM 确认的"这句话指的是业界主流的 **LLM 驱动 ADD/UPDATE/DELETE/NOOP 分类管线**。完整流程如下：

#### 问题：为什么简单去重不够？

| 问题 | 示例 |
|------|------|
| **纯文本匹配失败** | "我喜欢 Python" vs "我偏好用 Python 写脚本"——语义相同但文字不同 |
| **覆盖式更新** | "我用暗色模式" → "我换成了亮色模式"——旧记忆还在，Agent 看到矛盾信息 |
| **增量细化** | 先说了"我是程序员"，后说了"主要用 Go 写后端"——被存成两条独立记忆而非合并 |

#### 标准方案：三阶段 LLM 管线（Mem0 2025 版、社区实现）

```
新对话 → [Stage 1: 事实提取] → [Stage 2: 动作分类] → [Stage 3: 执行]
```

**Stage 1 — 事实提取**
LLM 从对话中提取候选事实，输出结构化 JSON：
```json
{ "facts": ["用户偏好 Python", "用户住在北京", "用户在做电商项目"] }
```

**Stage 2 — 动作分类（核心创新）**
对每个候选事实，先做向量相似度检索拿到 top-N 最相似的已有记忆，然后让一个**便宜的 LLM**（如 GPT-4o-mini / Haiku）判断：

| 动作 | 含义 | 行为 |
|------|------|------|
| **ADD** | 全新信息，无相似记忆 | 分配新 ID，存入 |
| **UPDATE** | 覆盖或修正旧信息 | 保留旧 ID，更新内容，刷新 `lastConfirmedAt` 时间戳 |
| **DELETE** | 与旧记忆矛盾 | 软删除或标记为已失效，写入 `supersedes` 链接指向新记忆 |
| **NOOP** | 已存在，完全重复 | 跳过，不存储 |

**Stage 3 — 执行**
根据分类结果执行对应的存储操作。

#### 两个关键实现细节

**细节 1：语义槽覆盖 vs 追加**

不是简单的全文替换。比如：
- 已有：`{ 饮食偏好: "不吃海鲜" }`
- 新增：`{ 饮食偏好: "不吃海鲜，但吃虾" }`

LLM 需要判断是 **UPDATE**（全覆盖）还是 **APPEND**（追加细化）。Memorix 项目专门区分了这两种。

**细节 2：失效而非删除（Invalidate, Not Delete）**

RedPlanetHQ 的做法：矛盾的旧记忆不删除，而是记 `invalidatedAt` 时间戳 + `invalidatedBy` 来源。这样能回答"我之前知道什么？"这种回溯查询。

#### 2026 年新趋势：从写时去重转向读时融合

| 方案 | 代表 | 原理 |
|------|------|------|
| **写时去重（2025 主流）** | Mem0 2025、Memorix | 存入前 LLM 分类 ADD/UPDATE/DELETE/NOOP |
| **积累 + 读时融合（2026 新趋势）** | Mem0 2026.4 更新 | 只 ADD，不 UPDATE/DELETE，检索时融合多条相似记忆 |
| **存原文不提取（2026 新趋势）** | MemMachine | 存完整对话 episode 不压缩，检索时用核匹配 + 前后文扩展 |

**写时去重**的问题是：LLM 分类本身可能出错（错误合并、错误覆盖），且一旦写错无法恢复。
**读时融合**的优势是：不丢信息，检索时让 LLM 看到所有相关版本自行判断。代价是存储量增大和检索结果更"嘈杂"。

Mem0 在 2026 年 4 月的重大更新中，**从 2 次 LLM 调用（extract + decide）改为 1 次（ADD-only）**，完全放弃了 UPDATE/DELETE。LoCoMo 得分从 71.4 跃升至 91.6，印证了"存全量优于存判断"。

#### 给 aichat 的建议

初期用简化版去重管道：
1. 新候选记忆 → 向量检索 top-3 相似旧记忆
2. 如果最高相似度 > 0.95 → **NOOP**（完全重复）
3. 如果相似度 0.85–0.95 → 将新旧一起交给 LLM 判断 ADD/UPDATE/NOOP
4. 如果 < 0.85 → 直接 **ADD**
5. UPDATE 时保留旧 ID，追加 `updatedAt` 时间戳，不删除旧版本（保留回溯能力）

#### 矛盾记忆的具体处理：新旧如何关联？

你问到"旧记忆打上时间戳保留，那与之矛盾的新记忆怎么处理"——这是整个管道中最核心的细节。业界标准做法是 **superseded_by 链表模式**：

```
旧记忆（已被推翻）                新记忆（当前有效）
┌─────────────────────┐          ┌─────────────────────┐
│ id: mem_001         │          │ id: mem_005         │
│ content: "用暗色模式" │ ◄─────── │ content: "用亮色模式" │
│ status: invalidated │ 链       │ status: active      │
│ superseded_by: ─────┼──指向───→│ supersedes: mem_001 │
│ invalidatedAt: 3/15 │          │ createdAt: 3/15     │
│ valid_until: 3/15   │          │ valid_from: 3/15    │
└─────────────────────┘          └─────────────────────┘
```

**新旧记忆的各自状态：**

| 属性 | 旧记忆 (mem_001) | 新记忆 (mem_005) |
|------|-----------------|-----------------|
| **status** | `invalidated` | `active` |
| **superseded_by** | `mem_005`（链向推翻它的新记忆） | `null` |
| **invalidatedAt** | `2026-03-15` | `null` |
| **valid_until** | `2026-03-15`（事实在现实中的失效时间） | `null`（当前仍有效） |
| **查询行为** | 默认过滤掉（`WHERE status = 'active'`） | 默认返回 |
| **回溯查询** | 可通过 `as-of 2026-02-01` 查到 | 查不到（那时还没有它） |

**两种查询模式：**

```
# 默认模式：只返回当前有效记忆
SELECT * FROM memories WHERE status = 'active'

# 回溯模式：查询"我在 2026 年 2 月知道什么？"
SELECT * FROM memories WHERE valid_from <= '2026-02-15' 
  AND (valid_until IS NULL OR valid_until > '2026-02-15')
```

**为什么不让新记忆直接覆盖旧记忆？** 因为用户可能会问回溯性问题：
- "我之前喜欢暗色模式，什么时候换的？" → 需要 mem_001 + mem_005 同时存在
- "去年我的技术栈是什么？" → 需要时间点查询

这就是报告前面提到的 **"失效而非删除"（Invalidate, Not Delete）** 原则的具体实施。

**跨项目实现对比：**

| 项目 | 链接方式 | 存储 |
|------|---------|------|
| **MemMachine** | episode → `DERIVED_FROM` 边 → derivative，旧 episode 保留不动 | Neo4j 图数据库 |
| **Memanto** | 每条记忆带 `confidence` + `provenance` 元数据，13 种类型分类 | - |
| **context-fabrica** | `superseded_by` 软失效链，staged → canonical → pattern 三级 | - |
| **VEKTOR** | `superseded_by` 列，AUDN 写入门控，`memory.delta()` 查询变更历史 | SQLite + LanceDB |
| **Kumiho** | URI 不可变节点 + 可变标签指针，AGM 信念修正形式化证明 | Neo4j + Redis |

---

## 六、对话分段策略（向量化前的 Chunking）

AI 对话形式的文本在向量化之前必须先分块。分块质量直接决定检索精度——切得太小丢失上下文，切得太大检索不准。以下是 2025-2026 年主流方案的梳理。

### 6.1 对话场景的特殊挑战

对话文本与普通文档有本质区别：

| 维度 | 普通文档 | 对话 |
|------|---------|------|
| 语义完整性单元 | 段落/章节 | 对话轮次（turn） |
| 上下文依赖 | 前一段与后一段 | 用户消息 ↔ 助手回复间强绑定 |
| 指代关系 | 跨段较少 | "它"、"这个"、"上次聊到的"遍布 |
| 主题切换 | 按章节 | 随时跳跃，无明确边界 |

最核心的问题：**如果 chunk 边界切在 turn 中间，用户问题里的"它"会丢失前一条助手消息中的指代对象，导致检索时完全匹配错误。**

### 6.2 2025-2026 年主流分段策略分级

```
成本：固定大小 < 滑动窗口 < 语义相似度 < Late Chunking < LLM 分段
精度：固定大小 < 滑动窗口 < 语义相似度 < LLM 分段 < Late Chunking
```

#### 策略 1：Turn 级分段（对话最基础的单元）

以单轮对话（user message + assistant response）为一个 chunk。

```
chunk_1: { user: "你好", assistant: "你好！有什么可以帮你？" }
chunk_2: { user: "今天天气怎么样", assistant: "请告诉我你在哪个城市？" }
```

**优点：** 实现简单，每个 chunk 语义完整
**缺点：** 多轮连续讨论同一话题时，单个 turn 信息量不足，检索出来是碎片

**适用：** 作为基础单元，配合下面策略组合使用

#### 策略 2：滑动窗口 Turn 分组（对话场景最常用）

将 N 个连续 turn 打包为一个 chunk，窗口间有重叠。

```python
# 窗口大小 = 3 turns，步长 = 2 turns（重叠 1 turn）
turns = [t1, t2, t3, t4, t5, t6]
chunks = [
    [t1, t2, t3],           # chunk 0
    [t3, t4, t5],           # chunk 1（t3 重叠）
    [t5, t6, t7],           # chunk 2（t5 重叠）
]
```

**关键参数（2025 生产环境经验值）：**
- 窗口大小：3~5 个 turn
- 重叠：1~2 个 turn（20~30%）
- 每个 chunk 约 300~800 tokens

**为什么重叠很重要：** 用户追问"那个方案的优缺点呢"——"那个方案"的指代对象在上一个窗口的末尾。没有重叠，指代链断裂。重叠 turn 让相邻窗口都有指代源。

#### 策略 3：语义主题分段（Semantic Chunking）

不在固定 turn 数处切，而是在**主题切换点**切。

**实现：** 计算相邻 turn 的 embedding 余弦相似度。当相似度骤降（> 阈值），说明话题变了，在此处切。

```
turn_1_2_3 (讨论 Python 性能)    ← 相似度 0.89
turn_4 (讨论周末旅行计划)         ← 相似度骤降至 0.32 → 在此处切
turn_5_6 (讨论下周机票)           ← 相似度 0.91
```

**2025 年验证数据：** 语义分段比固定大小分段在对话场景中 **IoU 提高 18.3%**。

**带有阈值的语义分段算法（2025 论文，含滑动窗口）：**
```python
def semantic_chunk(turns, embedding_model, threshold=0.65):
    embeddings = [embedding_model.embed(t.text) for t in turns]
    chunks, current_chunk = [], [turns[0]]
    
    for i in range(1, len(turns)):
        sim = cosine_similarity(embeddings[i], embeddings[i-1])
        if sim < threshold:    # 主题切换
            chunks.append(current_chunk)
            current_chunk = [turns[i]]
        else:
            current_chunk.append(turns[i])
    chunks.append(current_chunk)
    return chunks
```

**关键：阈值调优。** 2025 论文使用二分搜索动态调整阈值——太低了切不够，太高了切太碎。可针对不同对话类型（闲聊/技术讨论/客服）维护不同阈值。

#### 策略 4：Late Chunking（2025 突破性技术）

**核心思路反转：先对整个对话做 embedding，再切分。**

传统做法：先切 → 对每个 chunk 独立 embedding → 跨 chunk 的指代（"它"、"这个方案"）在做 embedding 时已经丢失，无法恢复。

Late Chunking（Jina AI，2025）：先把整个对话输入长上下文 embedding 模型（8192 tokens），获得 token 级别的 embedding → 再切 chun多 → 对每个 chunk 的 token embedding 做 mean pooling = chunk 的最终向量。

**效果：** 每个 chunk 的向量"知道"全局上下文。比如 chunk 3 中 "它的性能非常好"，做 embedding 时模型 attend 过 chunk 1 中的 "Python 3.12"，因此这个 "它" 的向量朝向 Python 方向。

**余弦相似度改善：** 0.69-0.83 → 0.85-0.88（+10~12%）

**局限：** 需要支持 token-level embedding 的模型（Jina v2/v3、E5、SBERT），OpenAI 的 embedding API 只返回最终池化向量，无法用于 Late Chunking。

#### 策略 5：Contextual Retrieval（Anthropic，最精准但最贵）

**核心思路：让 LLM 给每个 chunk 写一段"上下文说明"，把这个说明和 chunk 原文拼在一起做 embedding。**

```
原始 chunk: "它的性能比 3.11 版本提升了 40%"
LLM 生成的上下文: "这是关于 Python 3.12 发布说明中性能部分的讨论"
拼在一起做 embedding: "这是关于 Python 3.12 发布说明中性能部分的讨论\n它的性能比 3.11 版本提升了 40%"
```

**实测效果（Anthropic 基准）：**
| 配置 | 检索失败率 | 相对改善 |
|------|-----------|---------|
| 朴素分段 | 5.7% | 基线 |
| + Contextual Retrieval (embeddings) | 3.7% | −35% |
| + Contextual Retrieval (embeddings + BM25) | 2.9% | −49% |
| + Reranker | 1.9% | −67% |

**成本：** 每百万 token 约 $1.02（一次性索引成本）；prompt caching 可降 90%。

### 6.3 分级推荐（按 aichat 场景）

| 阶段 | 策略 | 为什么 |
|------|------|--------|
| **MVP** | Turn 级 + 滑动窗口（3 turn / 重叠 1 turn） | 零额外成本，实现简单，效果可接受 |
| **优化** | + 语义主题分段 | 语义相似度阈值切分，解决话题碎片化 |
| **进阶** | + Contextual Retrieval | Anthropic 方案的简化版——用便宜的 LLM 给每个 chunk 加一句话上下文描述 |
| **极致** | Late Chunking | 需要换 embedding 模型到 Jina，全自动无 LLM 开销 |

### 6.4 分段后的元数据策略

每个 chunk 除正文外，应附带元数据以提升检索精度：

```json
{
  "chunk_id": "user_123_session_456_chunk_003",
  "user_id": "user_123",
  "session_id": "session_456",
  "turn_range": [5, 8],
  "timestamp": "2026-05-09T14:30:00Z",
  "topic_tags": ["python", "性能优化"],
  "turn_count": 3,
  "chunk_size_tokens": 412
}
```

检索时可以叠加过滤条件（"只要最近 30 天的、关于 Python 的"），大幅减少语义搜索的噪音。

### 6.5 Embedding 模型上下文窗口溢出的处理

你提出的问题非常实际：**讨论项目时，3 个 turn 可能就 2000+ tokens，而常见 embedding 模型只有 512 token 上下文。** 这是生产环境中最容易踩的坑之一。

#### 常见 Embedding 模型的上下文限制

| 模型 | 最大输入 | 实际可用 | 适用 |
|------|---------|---------|------|
| `all-MiniLM-L6-v2` | 256 tokens | ~200 tokens | 轻量本地 |
| `bge-large-zh-v1.5` | 512 tokens | ~450 tokens | 中文 RAG |
| `text-embedding-3-small` | 8,191 tokens | ~8,000 tokens | 通用 |
| `text-embedding-3-large` | 8,191 tokens | ~8,000 tokens | 高精度 |
| `jina-embeddings-v3` | 8,192 tokens | ~8,000 tokens | Late Chunking |
| `voyage-3` | 32,000 tokens | ~32,000 tokens | 长文本 |

**关键：对于中文聊天项目，如果用 `bge-large-zh-v1.5`（512 token 限制），3 turn 的项目讨论轻松溢出。**

#### 溢出处理策略（按优先级排列）

**策略 A：换大上下文 embedding 模型（首选，最省事）**

直接用 `text-embedding-3-small` 或 `voyage-3`，8K~32K 上下文足够覆盖绝大多数对话 chunk。成本极低（$0.02/百万 token），不需要架构改动。

**策略 B：子句级拆分 + 池化（模型受限时的补丁）**

当必须用小上下文模型时，不拿整段对话去 embedding，而是：

```
1. 先对 turn 组做自然切分：按段落/句子拆成子句
2. 每个子句分别 embedding
3. 取所有子句 embedding 的 mean pooling 作为该 chunk 的向量
4. 同时保留各子句向量用于精确检索
```

```python
def embed_long_chunk(chunk_text, embed_model, max_tokens=450):
    # 按句子拆分
    sentences = split_sentences(chunk_text)  # 中文按 。！？\n 切
    embeddings = []
    batch = ""
    
    for sent in sentences:
        if token_count(batch + sent) > max_tokens:
            # 当前批次满了，提交 embedding
            embeddings.append(embed_model.embed(batch))
            batch = sent
        else:
            batch += sent
    
    if batch:
        embeddings.append(embed_model.embed(batch))
    
    # mean pooling = chunk 级别向量
    return np.mean(embeddings, axis=0), embeddings  # 返回全局 + 子句向量
```

检索时用 chunk 级别向量做粗筛（召回 top-20），再用子句向量做精排（找出最相关的那几个子句）。

**策略 C：Late Chunking（Jina 方案，终极解）**

整段对话先进支持 8192 token 的 Jina embedding，拿到 token-level embedding 后再切分——每个 chunk 的向量都有全局上下文感知。一次 embedding 解决所有问题，不需要做 mean pooling 的折衷。

**策略 D：分层检索（混合粒度）**

不管 chunk 多长，存两个粒度：
- **粗粒度 chunk**（全文级）→ 用大模型 embedding 做粗筛
- **细粒度句子**（句子级）→ 用小模型 embedding 做精排

这是目前成本与精度之间的最优折衷。

#### 给 aichat 的建议

**如果预算允许，直接用 `text-embedding-3-small`（$0.02/百万 token，8191 上下文），所有溢出问题都不存在。**

如果必须本地运行，用 `bge-large-zh-v1.5` + 策略 B（子句拆分 + mean pooling），加上策略 D（双粒度）做检索。

### 6.6 特殊场景

**长消息（用户一次发几百字）：** 先按自然段落或语义分段拆分用户消息，再按 turn 分组。不要把一个 800 字的用户消息硬塞进一个 chunk。

**多模态（图片/语音）：** 图片/语音本身不参与文本分段。在分段时，把图片描述/ASR 转写文本作为该 turn 的一部分。元数据中标记 `has_image: true`，检索时如需多模态可以追溯到原始文件。

**代码块：** 对话中的代码块不应在中间被切断。分段时要识别 markdown 代码围栏，如果代码块会跨越 chunk 边界，把边界外移。

---

## 七、记忆提取与原始对话的双向链接

你提到的"Agent 提取记忆，然后关联回原始对话片段"——这正是 2025-2026 年记忆系统最核心的架构趋势：**"存摘要也要存来源"**。以下是有这个能力的项目详解。

### 7.1 核心问题

传统做法是：对话结束 → LLM 提取事实 → 存到向量库。查询时只返回事实本身，用户无法回溯原始对话。

```
旧做法：  对话 → LLM 提取 → "用户喜欢 Python"（来源丢失）
新做法：  对话 → LLM 提取 → "用户喜欢 Python" + source_link → 原始对话片段（来源可查）
```

**来源丢失的后果：**
- 用户问"我什么时候说过这个？"→ 无法回答
- 提取错误（LLM 幻觉）→ 无法验证
- "我当时说的具体是什么？"→ 只能看到 LLM 压缩后的一句话

### 7.2 有双向链接能力的项目

#### MemMachine — 最完整的实现

MemMachine 是目前把"提取 ↔ 原始对话"这一块做得最彻底的项目。

**存储架构：**

```
原始对话 (Episode)                    提取片段 (Derivative)
┌──────────────────────┐     DERIVED_FROM 边     ┌──────────────────────┐
│ episode_id: ep_042   │ ◄──────────────────── │ derivative_id: d_103  │
│ timestamp: 2026-05-09│                        │ content: "用户偏好    │
│ session_id: s_789    │                        │   Python 做后端开发"  │
│ producer: "user"     │                        │ source_ep: ep_042     │
│ raw_text: "我平时用  │                        │ turn_index: 3         │
│   Python 写后端..."   │                        │ embedding: [0.1, ...] │
└──────────────────────┘                        └──────────────────────┘
```

**检索时自动扩展上下文（contextualized retrieval）：**

```
1. 用户查询 → 向量匹配找到 derivative d_103
2. 沿着 DERIVED_FROM 边 → 找到原始 episode ep_042
3. 自动拉取 ep_042 的前 1 个 + 后 2 个 episode（恢复完整对话流）
4. 把原始对话作为引用注入 LLM 上下文
```

这样 LLM 看到的不是一句孤立的"用户喜欢 Python"，而是完整的对话上下文——包括用户什么时候说的、前因后果、当时的语气。

**为什么不直接用 LLM 提取代替存原文？** MemMachine 的设计哲学是：LLM 提取会丢失 30-40% 的信息（"提取漂移"），且无法事后验证。存原文 + DERIVED_FROM 边，既保证了检索效率（向量搜 derivative），又保证了信息不丢失（沿边回溯原文）。

#### Memanto — 每条记忆都带来源

Memanto 在每条记忆上强制附加两个字段：

```json
{
  "fact": "用户使用 PostgreSQL 作为主数据库",
  "confidence": 0.94,
  "provenance": {
    "source_session": "session_456",
    "source_turns": [12, 14, 17],
    "extraction_model": "gpt-4o-mini",
    "extracted_at": "2026-05-09T14:30:00Z"
  }
}
```

`source_turns: [12, 14, 17]` 指向原始对话中的具体 turn。用户可以点击跳转回原始对话查看。

#### PlugMem（UIUC & 清华）— 知识单元代替文本块

PlugMem 的核心创新：**检索单元是"结构化的知识单元"而非"文本块"。**

```
文本块方式：
  "上次聊到 Python 3.12 的新特性，用户对类型系统改进很感兴趣..."（一大段文本）

知识单元方式：
  { subject: "用户", predicate: "感兴趣", object: "Python 3.12 类型系统" }
  { source: "session_456_turn_12", timestamp: "2026-05-09" }
```

每个知识单元都有 `source` 字段指向原始对话。但**如何检索这种结构化知识单元**，是整个架构最关键的工程问题。答案是 **"都不是单独用的，是混合管线"**。

#### 知识单元的检索：向量初筛 → 图遍历扩展 → RRF 融合

单独靠向量、关键词或图遍历都不够——三者的盲区不同，必须组合：

| 检索方式 | 能抓到 | 会漏掉 |
|----------|--------|--------|
| **向量（语义搜索）** | "喜欢编程" ↔ "对 Python 感兴趣"（语义相近） | "用户"和"Python 3.12" 两个实体间的关系 |
| **关键词/BM25** | 精确匹配 "Python 3.12 类型系统" | "对语言新特性有兴趣"（说法不同） |
| **图遍历（SPO 边）** | 多跳推理——用户→感兴趣→Python→擅长→后端 | 孤立的、未建图的新知识 |

**标准管线（PlugMem + SYNAPSE + Graphiti 的方案，分层执行）：**

```
用户查询: "用户对什么技术感兴趣？"
    │
    ▼
┌─────────────────────────────────────────────┐
│ Step 1: 向量粗筛（高召回）                    │
│ 将查询做 embedding，在知识单元库中搜 top-50   │
│ 找到: "用户→感兴趣→Python 3.12 类型系统"      │
│       "用户→使用→PostgreSQL"                  │
│       "用户→偏好→暗色模式"  ← 不相关但语义近   │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ Step 2: 图遍历扩展（多跳 + 关系补全）          │
│ 以 "Python 3.12 类型系统" 为种子节点          │
│ 沿知识图谱边扩散（spreading activation）:      │
│                                               │
│ Python 3.12 类型系统                           │
│   ├── 属于 → Python（概念层级上升）            │
│   ├── 相关 → FastAPI（发现新关联）             │
│   └── 用户也感兴趣 → Rust ← 本来漏掉了！       │
│                                               │
│ 激活衰减: λ^depth（一跳 1.0，二跳 0.5，三跳 0.25）│
│ 横向抑制: 已被激活的节点不再重复扩散           │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ Step 3: RRF 多信号融合                        │
│ 向量结果 rank + 图遍历结果 rank + BM25 rank   │
│ → 用 Reciprocal Rank Fusion 合并为一个排序     │
│ → 取 top-20                                   │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ Step 4（可选）: LLM Rerank                    │
│ 将 top-20 知识单元 + 用户查询交给轻量 LLM     │
│ "哪些与当前查询最相关？重新排序"               │
│ → 最终返回 top-5                              │
└─────────────────────────────────────────────┘
```

**PlugMem 特有的"抽象-具体交错"策略：**

PlugMem 在图遍历时不是机械地一层层走，而是在 abstract 节点（概念层，"用户在学编程"）和 concrete 节点（事实层，"用户→感兴趣→Python 3.12 类型系统"）之间交替跳跃。这样既能按"用户是程序员"收敛到技术领域（抽象层路由），又能精确命中文档级事实（具体层有效载荷），避免在图的无关节邻里迷路。

**SYNAPSE 的 spreading activation 公式（简化）：**

```
activation(node) = initial_signal × λ^depth × temporal_decay
temporal_decay = e^(-α × days_since_last_access)

横向抑制: 已激活节点的邻居不再获得扩散权重，防止"回声室"
```

**三种检索方式成本对比：**

| 步 | 计算成本 | 延迟 |
|----|---------|------|
| 向量粗筛 | 1 次 embedding + ANN 搜索 | ~50ms |
| 图遍历 | 纯 CPU，无 LLM | ~20ms |
| RRF 融合 | 纯数学，O(n) | ~1ms |
| LLM Rerank | 1 次 LLM 调用 | ~200ms |

**给 aichat 的简化建议：** 初期不需要完整的图数据库。在 pgvector 的 memories 表上加 JSONB `entities` 字段存实体列表。检索时分两步：① 向量搜 top-20 → ② 如果候选记忆有共享的 entity（如都提到 "Python"），提升排名。这就是最低成本的"类图遍历"。

#### openclaw-hybrid-memory — 文档级溯源

GitHub Issue #748 专门讨论了"时间线摘要 ↔ 原始日志"的双向链接：

- 每个摘要条目带有 `source_session_id` + `turn_range`
- 支持"无损回忆"——点一下摘要自动跳回完整的原始对话
- 内存中保持 session log ↔ summary 的双向映射

### 7.3 给你的 aichat 的建议实现

```
┌─────────────────────────────────────────────────────────┐
│                    对话存储层                            │
│  sessions 表:                                           │
│    id, user_id, turns (JSONB [...]), created_at         │
│    每条 turn: { role, content, timestamp, turn_index }  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼  异步，会话结束触发
┌─────────────────────────────────────────────────────────┐
│                  记忆提取 Agent                          │
│  输入: session turns                                    │
│  输出: [                                                │
│    {                                                    │
│      "fact": "用户偏好 Python 做后端",                   │
│      "type": "preference",                              │
│      "source_session_id": "s_789",                      │
│      "source_turns": [3, 5],  ← 锚点！                  │
│      "confidence": 0.92                                 │
│    }                                                    │
│  ]                                                      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  记忆存储层                              │
│  memories 表:                                           │
│    id, user_id, fact, type, embedding (pgvector),       │
│    source_session_id, source_turns, confidence,         │
│    created_at, updated_at, status                        │
│                                                         │
│  检索时:                                                │
│    1. 向量搜 top-5 memory                               │
│    2. 每种 property 带 source_session_id + source_turns │
│    3. 前端展示时可以"查看原始对话"链接                  │
└─────────────────────────────────────────────────────────┘
```

**实现要点：**
1. `source_turns` 存的是 turn_index 数组，不是复制原文
2. 前端展示记忆时加一个"查看来源"按钮，点击展开原始对话片段
3. 记忆更新时保留旧版本的 source，形成"我什么时候说的 + 什么时候改的"完整链路
4. LLM 提取时在 prompt 中要求它输出 `source_turns`（reference 原始对话中的哪些 turn 支撑了这条事实）

---

## 八、与 aichat 当前架构的差距分析

| 能力 | 当前 aichat | 需要新增 |
|------|-----------|---------|
| 会话内上下文 | ✅ 已有 | - |
| 会话历史存储 | ✅ 已有 | - |
| 跨会话记忆提取 | ❌ | 异步记忆提取 Agent |
| 向量语义搜索 | ❌ | pgvector / ChromaDB |
| 用户画像存储 | ❌ | user_profile 表 |
| 记忆衰减/去重 | ❌ | 语义相似度 + superseded_by 链 |
| 记忆来源追溯 | ❌ | source_session_id + source_turns 字段 |
| 记忆 ↔ 原始对话双向链接 | ❌ | DERIVED_FROM 式边关系 |
| 分段策略 | ❌ | Turn 级 + 滑动窗口 + embedding 溢出处理 |
| 记忆管理 UI | ❌ | 记忆列表/编辑/删除/查看来源界面 |

---

## 九、建议实施路径

**Phase 1 — 温层落地（2-3 周）**
- 引入 pgvector 或 ChromaDB
- 实现会话结束后的异步记忆提取（LLM 调用提取事实/偏好）
- 每次新消息检索 top-5 相关记忆注入 system prompt
- 基础去重

**Phase 2 — 冷层建设（1-2 周）**
- 设计 user_profile 结构化存储（偏好表、知识表、事件表）
- 定期从温层合并稳定记忆到冷层
- 记忆衰减 + 冲突解决
- 管理 UI（记忆列表、编辑、删除）

**Phase 3 — 高级特性（按需）**
- 知识图谱（实体关系推理）
- 记忆跨设备同步
- MCP 协议支持（与其他 AI 工具共享记忆）
- 多模态记忆（图片、语音）

---

## 十、参考资料

- [MemMachine 论文](https://arxiv.org/abs/2604.04853) — 情节记忆 + 档案记忆双层架构
- [Open WebUI](https://github.com/open-webui/open-webui) — 135k star 的成熟聊天应用，Adaptive Memory 实现
- [LobeChat Issue #9654](https://github.com/lobehub/lobehub/issues/9654) — Global Conversation Memory 需求讨论
- [Mem0](https://github.com/mem0ai/mem0) — 三合一混合存储架构
- [OpenMemory MCP](https://mem0.ai/blog/introducing-openmemory-mcp) — 跨客户端记忆共享协议
- [MemoryGraph](https://github.com/Loul-Zaster/MemoryGraph) — LangGraph + ChromaDB 的 6 节点记忆工作流
- [5 AI Agent Memory Systems Compared](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3) — 2026 横向评测数据
