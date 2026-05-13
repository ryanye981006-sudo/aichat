# Claude Code 记忆机制与上下文管理分析方案

> 基于 Claude Code v2.1.88 逆向源码（约 1902 个 TS 文件，51.3 万行）及社区研究成果
> 撰写日期：2026-05-09

---

## 一、源码泄露背景

2026 年 3 月 31 日，安全研究者发现 Anthropic 发布到 npm 的 Claude Code 包中未删除 source map 文件，导致完整 TypeScript 源码被逆向还原。关键发现：**仅 1.6% 的代码是 AI 决策逻辑，98.4% 是确定性基础设施**（权限门、上下文管理、工具路由、恢复逻辑）。Agent 循环本身只是一个简单的 `while-loop`，真正的工程复杂度在其周边的 **"Harness（马具）"** 系统。

核心分析项目：
- [Inside-Claude-Code-Architecture](https://github.com/HZ0108/Inside-Claude-Code-Architecture-and-Design-Philosophy) — 9 大架构支柱分析
- [Dive into Claude Code](https://github.com/VILA-Lab/Dive-into-Claude-Code) — 学术论文级系统分析（arxiv 2604.14228）
- 华为云博客系列 — [Claude Code 记忆系统架构分析](https://bbs.huaweicloud.com/blogs/476317)

---

## 二、记忆系统整体架构：4 层递进

```
CLAUDE.md（静态规则层 — 用户手写）
    ↓
Auto Memory（动态自动记录层 — LLM 自主提取 + MEMORY.md 索引 + 多主题 .md）
    ↓
Auto Dream（后台压缩层 — 合并碎片化记忆 / 删除矛盾 / 精简索引）
    ↓
KAIROS（常驻守护进程层 — 源码中发现，尚未正式发布）
```

### 2.1 设计哲学：文件系统优先

Claude Code 选择**纯 Markdown + YAML Frontmatter** 文件方案，而非向量数据库：

| 对比维度 | 向量数据库方案 | Claude Code 文件方案 |
|----------|---------------|---------------------|
| 可读性 | 需专用工具 | 编辑器直接打开 |
| 版本控制 | 困难 | Git 原生支持 diff/review |
| 基础设施 | 需要 Chroma/Milvus 等 | 零额外依赖 |
| 检索方式 | Embedding 相似度 | LLM 自主选择 |
| 可调试性 | 黑盒 | 白盒，每行可见 |

### 2.2 存储路径结构

```
~/.claude/
├── CLAUDE.md                          # 用户全局规则（所有项目共享）
├── projects/<project-path>/
│   ├── memory/
│   │   ├── MEMORY.md                  # 索引文件（≤200 行，≤25KB）
│   │   ├── user_role.md              # 用户身份/偏好
│   │   ├── feedback_testing.md       # 用户反馈与纠正
│   │   ├── project_auth.md           # 项目决策/截止日期
│   │   └── reference_linear.md       # 外部系统指针
│   └── transcripts/
│       └── <session-id>.jsonl        # 会话日志（每行一条 JSON 消息）
└── settings.json                      # 权限/工具配置
```

项目级：
```
<project-root>/
├── CLAUDE.md                          # 项目规则（团队共享，git 跟踪）
├── CLAUDE.local.md                    # 个人规则（gitignore）
├── .claude/
│   ├── CLAUDE.md                      # 项目本地规则（替代位置）
│   ├── rules/                         # 模块化规则目录
│   │   └── api-conventions.md         # 路径作用域规则（YAML frontmatter + glob）
│   ├── settings.json                  # 项目级权限配置
│   └── scheduled_tasks.json           # 持久化定时任务
```

---

## 三、上下文管理：5 层压缩管线

Claude Code 遵循 **"零故意信息丢失"** 哲学，在每次模型调用前**按成本从低到高**依次执行 5 层压缩：

```
Layer 1: Budget Reduction    →  始终检查，先尝试降低 token 预算
Layer 2: History Snip        →  Token 紧张时，选择性截断早期无关历史
Layer 3: Microcompact        →  Snip 不足时，清理过期工具结果 + cache_edits 保持缓存命中
Layer 4: Context Collapse    →  接近极限时，将长对话块归档为元数据占位符（实验性）
Layer 5: Auto-Compact        →  Token ≥ ~87% 时，调用压缩 Agent 生成结构化摘要替换原始历史
```

### 3.1 关键参数

| 参数 | 值 |
|------|-----|
| 自动压缩触发阈值 | ~87% token 利用率 |
| 自动压缩缓冲 | 13,000 tokens |
| 警告阈值缓冲 | 20,000 tokens |
| 摘要输出上限 | 20,000 tokens |
| 最大连续压缩失败次数 | 3 次 |
| Session Memory Compaction 保留范围 | 10,000 ~ 40,000 tokens |
| 压缩后文件恢复预算 | 5,000 tokens |
| CLAUDE.md 推荐上限 | ≤200 行（约 2,000~4,000 tokens） |
| MEMORY.md 硬上限 | 200 行或 25KB（先到者为准） |
| 总记忆预算建议 | <10,000 tokens（约 200K 窗口的 5%） |

### 3.2 各层详解

**Layer 1 — Budget Reduction（预算缩减）**
最轻量的一层。优先尝试降低 token 预算而非操作内容，成本最低。

**Layer 2 — History Snip（历史剪裁）**

> 源码位置：`compact/snipCompact.ts`，调用方：`src/query.ts`（主查询状态机）
> 由 `HISTORY_SNIP` feature gate 控制，非默认开启

**核心结论：Snip 不做语义相关性判断。** 它是最便宜的压缩层（零 LLM 调用，纯数组 splice），只按时间维度做 FIFO 头部截断。

**工作原理：**

```
┌─────────────────────────────────────────┐
│  [消息1] [消息2] [消息3] [消息4] [消息5] │
│  ←── Snip 删除（头部 FIFO）              │
│                        保留最近 N 轮 ──→  │
└─────────────────────────────────────────┘
```

当上下文增长到一定阈值时，直接从对话历史**头部**（最旧的消息）截断一段。不做语义分析、不打分、不判断重要性——这只是一种极低成本的"盲剪"。

**与 AutoCompact 的显式协作：**
```typescript
// AutoCompact 计算触发阈值时使用：
effectiveTokens = tokenCount - snipTokensFreed
// Snip 释放了多少，AutoCompact 就少干多少
```
这是管线设计中最精巧的部分——各层之间不是孤立的，而是通过 `snipTokensFreed` 向下传递状态。

**那么"如何判断与当前任务无关"的答案是什么？**

这个判断**不是由 Snip 一个层完成的**，而是分布在 5 层管线中逐级精细化：

| 判断方式 | 负责层 | 机制 |
|----------|--------|------|
| **时间衰减** | Snip (L2) | FIFO 头部截断——假设越旧越无关，不验证 |
| **工具类型白名单** | Microcompact (L3) | `COMPACTABLE_TOOLS` = {Read, Bash, Grep, Glob, WebSearch, WebFetch, Edit, Write}——这些工具输出"随时间快速贬值"，可安全清理 |
| **时间触发** | Microcompact (L3) | 距上次主线程 Assistant 消息超过 60 分钟 → 清空旧 tool_result 为 `[Old tool result content cleared]`，保留最近 `keepRecent: 5` 条 |
| **缓存感知三分区** | Microcompact (L3) | 将上下文分为 `mustReapply` / `frozen` / `fresh` 三区——宁可少释放空间也不打碎已命中的 prompt cache prefix |
| **语义重要性** | AutoCompact (L5) | LLM 生成结构化摘要——这是唯一真正理解"什么重要"的层，保留决策点、丢弃中间过程 |

**设计哲学：把贵的判断留到最后做。** 先用便宜的 FIFO 截断、工具类型白名单、时间衰减过滤掉大量"几乎肯定无关"的内容，只把剩下来真正需要语义理解的部分交给 LLM（AutoCompact），最大化节省 API 成本。

**Layer 3 — Microcompact（微压缩）**
- **工具类型白名单**：`COMPACTABLE_TOOLS` = {Read, Bash, Grep, Glob, WebSearch, WebFetch, Edit, Write}——这些工具输出随时间快速贬值，读过的文件会被修改、跑过的命令输出会过时
- **时间触发 MC**：距上次主线程 Assistant 消息超过 60 分钟时，把旧 tool_result 内容清空为 `[Old tool result content cleared]`，保留最近 `keepRecent: 5` 条
- **缓存编辑 MC**：利用 Anthropic API 的 `cache_edits` 特性，不修改本地消息内容，而是告知服务端删除缓存中的旧 tool_result，**保护 prompt cache prefix 不被破坏**
- 此层的核心目标：**减少 token 的同时保持缓存热度**（实测前缀复用率 92%~97.83%）

**Layer 4 — Context Collapse（上下文折叠，实验性）**
类似操作系统的分页策略——将长对话块归档为元数据占位符，防止 413 "prompt too long" 错误。当前仍标记为实验性功能。

**Layer 5 — Auto-Compact（自动压缩，最终手段）**
- 当 token 达到约 87% 利用率时触发
- 调用一个独立的压缩 Agent（Forked Agent）
- 生成 `SystemCompactBoundaryMessage`，用 AI 生成的 Markdown 摘要替换原始历史
- 压缩后自动重新读取 CLAUDE.md 注入上下文
- 子目录 CLAUDE.md 在下次文件访问时懒加载

### 3.3 上下文动态注入：`<system-reminder>` 标签

运行时信息的按需注入机制——不永久污染静态 system prompt，而是每轮动态注入：

- **记忆陈旧度警告**：当记忆超过一定时间阈值，提醒 LLM "此信息可能已过时，使用前请验证当前代码"
- **恶意代码警告**：检测到可疑指令时的安全告警
- **工具状态**：后台任务完成通知、定时器触发等

这是将**运行时上下文按需注入**的优雅设计，使得动态信息能在不修改基础 system prompt 的前提下影响模型行为。

---

## 四、长期记忆机制详解

### 4.1 四种记忆类型

源码中 `memoryTypes.ts` 定义了四种类型：

| 类型 | 用途 | 作用域 | 示例 |
|------|------|--------|------|
| **user** | 用户身份、角色、目标、知识背景 | 始终私有 | "用户是资深 Go 开发者，React 新手" |
| **feedback** | 用户反馈、偏好、行为纠正 | 私有/团队 | "测试必须用真实数据库，严禁 mock" |
| **project** | 项目决策、技术选型、截止日期 | 偏向团队 | "认证中间件重写是合规需求驱动的" |
| **reference** | 外部系统指针 | 团队共享 | "流水线 bug 在 Linear INGEST 项目中跟踪" |

### 4.2 记忆生命周期

```
触发条件（每 N 轮或 Stop Hook）
    ↓
[Extract 阶段]  独立 Forked Agent 分析 transcript
    ↓           提取值得长期保存的事实
    ↓           写入对应类型的 .md 文件
    ↓           更新 MEMORY.md 索引
    ↓
[Auto Dream 阶段]  触发条件：距上次 ≥24h + 新增 ≥5 个会话
    ↓             四阶段流水线：
    ├── Orient   读取所有记忆文件
    ├── Gather   收集新会话日志
    ├── Consolidate  合并相似记忆、删除矛盾信息
    └── Prune    精简索引，移除过时条目
```

### 4.3 记忆检索机制（非向量搜索）

Claude Code **不使用 Embedding 或向量相似度搜索**，而是采用 **LLM 自主选择**方案：

1. `scanMemoryFiles()` 遍历 memory 目录，解析每个文件的 frontmatter（type、description、mtime）
2. `formatMemoryManifest()` 将所有文件元数据格式化为模型可读清单
3. 模型被注入此清单到 system prompt，**自主选择 ≤5 个最相关的记忆文件**
4. 选中的记忆完整注入当前对话上下文

**设计考量：**
- 最多扫描 200 个文件
- 仅读前 30 行获取 frontmatter（不加载全文）
- 按 `mtime` 降序排列，新记忆优先
- LLM 的选择质量是关键——这依赖模型的理解能力而非数学相似度

### 4.4 记忆写入规范

- `MEMORY.md` 是索引，不是记忆——每行一个条目，格式 `- [标题](文件.md) — 一句话摘要`
- 记忆文件使用 YAML frontmatter（name, description, type）+ Markdown 正文
- feedback/project 类型记忆结构：**规则/事实 → Why → How to apply**
- 写入去重：先检查现有记忆是否可更新，再新建
- 记忆只写**不可从代码/git 推导的信息**——排除代码模式、git 历史、调试方案等

### 4.5 时效性与陈旧度管理

记忆根据 `mtimeMs` 评估陈旧度。超过特定阈值的记忆触发 `<system-reminder>` 提醒：
- 命名函数/文件的记忆 → 用前先 grep/read 验证
- 架构快照 → 信任当前代码 > 记忆
- 活动日志 → 用 `git log` 而非记忆快照

---

## 五、Agent 循环与工具编排

### 5.1 核心查询循环

```
assemble_context → call_model → dispatch_tools → check_permissions → execute → repeat
```

实现为 `AsyncGenerator`（`yield*` 状态机），流式产出文本、工具调用和遥测数据。

### 5.2 每轮 9 步管线

```
Settings 解析 → 状态初始化 → 上下文组装 → 5 个 pre-model shaper → 模型调用 → 工具分发 → 权限门 → 工具执行 → 停止条件判断
```

### 5.3 并发工具执行器

| 类型 | 工具示例 | 执行模式 |
|------|----------|----------|
| **并行安全** | Read, Glob, Grep | 并发执行 |
| **独占** | Bash, Write, Edit | 串行执行（防竞态） |

### 5.4 子 Agent 拓扑

| 类型 | 说明 |
|------|------|
| **LocalAgentTask** | 独立后台子进程，层级化 AbortController |
| **RemoteAgentTask** | 通过 MCP 在远程 CCR 环境执行 |
| **Coordinator Mode** | 元 Agent 模式——Coordinator 管理多个并行 Worker Agent |

---

## 六、权限与安全：7 层纵深防御

7 种权限模式构成渐进信任谱系：

```
plan → default → acceptEdits → auto(ML分类器) → dontAsk → bypassPermissions
```

**Deny-First 原则：** 宽泛的 deny 始终覆盖狭窄的 allow。权限**不在会话恢复时继承**——每次新会话重新建立信任。

---

## 七、关键设计原则

| # | 原则 | 解决的设计问题 |
|---|------|---------------|
| 1 | Deny-first with human escalation | 未识别操作：允许/阻止/升级？ |
| 2 | Graduated trust spectrum | 固定权限等级还是渐进信任谱系？ |
| 3 | Defense in depth | 单一安全边界还是多重重叠？ |
| 4 | Context as scarce resource | 单次截断还是渐进管线？ |
| 5 | Append-only durable state | 可变状态/快照/仅追加日志？ |
| 6 | Minimal scaffolding, maximal harness | 投资脚手架还是运维基础设施？ |
| 7 | Transparent file-based config & memory | 不透明数据库还是用户可见文件？ |
| 8 | Isolated subagent boundaries | 共享上下文还是隔离？ |

---

## 八、与当前 aichat 项目的关联分析

### 8.1 当前项目已具备的能力

- **MEMORY.md 系统**：已有 `feedback_plan_location.md` 记忆文件
- **CLAUDE.md 全局配置**：已有用户级语言规范和开发助手规范
- **会话管理**：Chat 系统本身涉及上下文管理

### 8.2 可借鉴的设计模式

1. **分层记忆架构**：当前只有一层 MEMORY.md，可扩展为 CLAUDE.md（静态规则）+ MEMORY.md（动态记忆）+ Dream（定期合并）三层
2. **四种记忆类型**：当前未区分 user/feedback/project/reference，可引入类型标记便于检索
3. **Frontmatter 索引**：当前 MEMORY.md 已使用 `- [标题](文件.md) — 摘要` 格式，可增加 type 字段
4. **陈旧度追踪**：可引入 `mtime` 检查和 `<system-reminder>` 式过期提醒
5. **Token 预算管理**：如果 aichat 也需要做上下文压缩，可参考 5 层管线设计

### 8.3 可忽略的部分

- **7 层权限系统**：aichat 作为 Chat 应用，权限模型与 CLI Agent 完全不同
- **子 Agent 拓扑**：除非 aichat 计划引入 Agent 模式，否则不需要
- **并发工具执行器**：与聊天应用场景不匹配

---

## 九、社区增强方案（扩展参考）

| 方案 | 核心技术 | 适用场景 |
|------|----------|----------|
| **Slavka Pattern** | CLAUDE.md 只存指针，详情独立文件按需加载 | 大型项目，知识无限扩展 |
| **claude-mem** | SQLite + Chroma + Web UI，5 个生命周期钩子 | 需要 UI 管理记忆 |
| **memsearch** | Milvus 向量索引 + shell hooks，纯 Markdown 存储 | 需要语义检索能力 |
| **cortex-claude** | 三级召回（facts→summaries→full），知识图谱 | token 敏感场景（节省 66%） |
| **cerebra** | 脑区启发多 Agent 外壳，文件型 hippocampus | 多 Agent 协作场景 |
| **Layered Memory (5层)** | L0 工作集 → L4 决策档案，按路径匹配加载 | 精细 token 预算控制 |

---

## 十、总结

Claude Code 的记忆与上下文管理系统本质上是 **"分层降级 + 文件优先 + LLM 自主选择"** 架构。核心洞见：

1. **Token 是稀缺资源**——5 层管线不是一次性解决问题，而是渐进降级，每层成本递增
2. **文件胜过数据库**——Markdown + Git 的可维护性远高于向量数据库的黑盒
3. **LLM 替代 Embedding**——让模型自己选相关的记忆，而非依赖数学相似度，这在记忆数量较少（<200）时完全可行
4. **Append-only + 定时合并**——Auto Dream 机制解决了碎片化记忆的增长问题
5. **Harness > Agent**——98.4% 的代码是基础设施，Agent 循环本身就几行。这暗示做 AI 应用时，真正价值在外围保障系统

对于 aichat 项目，建议重点借鉴**分层记忆架构**和**四种记忆类型分类**，逐步从当前的单层 MEMORY.md 演进为更结构化的记忆系统。
