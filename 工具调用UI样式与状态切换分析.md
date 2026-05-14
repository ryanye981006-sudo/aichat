# AI Chat 工具调用 — 样式显示与状态切换分析

---

## 一、数据模型

### ToolCallEntry（工具调用条目）

```typescript
interface ToolCallEntry {
  toolCallId: string;
  toolName: string;                    // search_memory | recall_context | recall_sources | web_search | web_fetch
  args: Record<string, unknown>;      // 调用参数，如 { query: "成都火锅" }
  result?: unknown;                    // 调用结果，结构因工具而异
  status: 'pending' | 'running' | 'done' | 'error';
  startedAt?: string;                  // ISO 时间戳
  completedAt?: string;               // ISO 时间戳
}
```

### ReasoningSegment（思考与工具调用的交错片段）

```typescript
type ReasoningSegment =
  | { type: 'reasoning'; text: string }       // 思考文本
  | { type: 'tool_call'; toolCall: ToolCallEntry };  // 工具调用
```

Message 同时保留 `reasoningSegments: ReasoningSegment[]`（新）和 `toolCalls: ToolCallEntry[]`（旧兼容）两个字段。

---

## 二、状态机

### 状态枚举

```
┌─────────┐     LLM 触发工具调用     ┌─────────┐
│ pending  │ ───────────────────────→ │ running │
└─────────┘                          └────┬────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │ 工具返回结果         │ 工具调用失败          │
                    ▼                     ▼                      │
              ┌─────────┐          ┌─────────┐                 │
              │  done   │          │  error  │                 │
              └─────────┘          └─────────┘                 │
```

### UI 表现对照表

| 状态 | UI 合并 | 图标 | 显示文本 | 参数显示 | 耗时 | 展开箭头 | 状态颜色 |
|------|---------|------|----------|----------|------|----------|----------|
| `pending` | 视为"运行中" | emoji 图标 | "搜索记忆中..." 等 | 不显示 | 不显示 | 不显示 | **无** |
| `running` | 视为"运行中" | emoji 图标 | "搜索记忆中..." 等 | 不显示 | 不显示 | 不显示 | **无** |
| `done` | 完成态 | emoji 图标 | "搜索到 N 条相关记忆" 等 | 显示 | 显示 | 有结果时显示 | **无** |
| `error` | **无独立 UI** | emoji 图标 | 显示 doneText (用 result 取值) | 若有关键参数则显示 | 可能显示 | 有 result 时显示 | **无** |

> **关键问题**：当前版本没有运行中动画（无旋转/脉冲/骨架屏），没有错误状态独立样式，也没有不同工具的颜色区分（5 个 `tool-*` CSS 类名已定义但**未实现 CSS**）。

---

## 三、工具类型与展示配置

代码位置：[src/components/ToolCallBlock.tsx:18-68](src/components/ToolCallBlock.tsx#L18-L68)

| 工具名 | Emoji | CSS 类（未实现） | 运行中文案 | 完成文案模板 | 展开详情组件 |
|--------|-------|-----------------|------------|-------------|-------------|
| `search_memory` | 🧠 | `tool-purple` | "搜索记忆中..." | "搜索到 N 条相关记忆" | `MemorySearchDetail` |
| `recall_context` | 💬 | `tool-blue` | "读取原始对话..." | "读取了 N 轮原始对话" | **无** |
| `recall_sources` | 📎 | `tool-indigo` | "读取附件/网页..." | "读取了 N 个来源" | **无** |
| `web_search` | 🌐 | `tool-green` | "搜索网页中..." | "搜索到 N 条网页结果" | `WebSearchDetail` |
| `web_fetch` | 📄 | `tool-teal` | "读取网页中..." | "读取了 {网页标题}" | 内联渲染 |

---

## 四、DOM 结构与 CSS

### 行内结构（运行态 & 完成态共用）

```
div.tool-call-block.py-1.text-xs (.tool-purple 等，当前无效果)
│  style: paddingLeft = depth × 20px
│
├── div.flex.items-start.gap-2 (完成态有结果时加 cursor-pointer + hover:opacity-80)
│   │  onClick → 展开/折叠详情
│   │
│   ├── span "├─" (仅 depth > 0, text-[10px] opacity-40 select-none, marginLeft: -8px)
│   │
│   ├── span.emoji (flex-shrink-0, mt-0.5) → 🧠/🌐/等
│   │
│   └── div.flex-1.min-w-0
│       ├── span.font-medium → 状态文本（runningText 或 doneText）
│       ├── span.opacity-60.ml-1 → 参数预览（仅完成态）
│       │   query → : "{queryArg}"     （原样）
│       │   memory_id → : {前12字符}
│       │   url → : {前50字符}
│       ├── span.opacity-40.ml-2 → 耗时 "523ms" / "1.5s"（仅完成态）
│       └── span (仅完成态有 result 时)
│           └── ChevronDown / ChevronRight (w-3 h-3, color: var(--color-primary))
│
└── [展开时] 详情区域（见下方）
```

### 展开详情 — WebSearchDetail

```
div.mt-2.space-y-1.5
└── div.rounded-lg.px-3.py-2.text-xs (bg: rgba(0,0,0,0.03))
    └── div.flex.items-start.gap-1.5
        ├── span (绿色圆编号, w-4 h-4, bg: #16a34a, text-white, text-[10px], rounded-full)
        ├── div.flex-1.min-w-0
        │   ├── a: 标题链接 (color: var(--color-text), font-medium, hover:underline)
        │   └── p: 摘要 (color: var(--color-text-2), opacity-70, 最多 200 字)
        └── a: ExternalLink 图标 (w-3 h-3, opacity-50, hover:opacity-100)
```

### 展开详情 — MemorySearchDetail

```
div.mt-2.space-y-1.5
└── div.rounded-lg.px-3.py-2.text-xs (bg: rgba(0,0,0,0.03))
    ├── div.font-medium → 记忆内容标题 (color: var(--color-text))
    └── span.text-[10px].opacity-50 → "相似度: 85%" (color: var(--color-text-3))
```

### 展开详情 — web_fetch（内联）

```
div.mt-2.rounded-lg.px-3.py-2.text-xs (bg: rgba(0,0,0,0.03))
├── div.font-medium → 网页标题 (color: var(--color-text))
└── div.mt-1.whitespace-pre-wrap (color: var(--color-text-2), opacity-70, max-h-40, overflow-y-auto)
    → 内容前 1000 字符
```

### 主题 CSS 变量

| 变量 | 暗色值 | 亮色值 | 用途 |
|------|--------|--------|------|
| `--color-text` | `#e6edf7` | `#4c5e86` | 详情标题文字 |
| `--color-text-2` | `rgba(230,235,247,0.6)` | `rgba(76,92,134,0.6)` | 工具状态文本、摘要 |
| `--color-text-3` | `rgba(230,235,247,0.38)` | `rgba(76,92,134,0.38)` | 相似度标签 |
| `--color-primary` | `#6887af` | `#687eaf` | 展开/折叠箭头 |
| `--color-border` | `rgba(230,235,247,0.15)` | `rgba(76,92,134,0.12)` | ThinkBlock 边框 |

---

## 五、嵌套层级算法

代码位置：[src/components/ChatArea.tsx:52-104](src/components/ChatArea.tsx#L52-L104)

### 嵌套规则

```
depth 0        depth 1           depth 2
🧠 search_memory ──→ 💬 recall_context ──→ 📎 recall_sources
  (memory_id: M1)      (memory_id: M1)        (memory_id: M1)

🌐 web_search ──────→ 📄 web_fetch
  (结果含 URL_A)         (url: URL_A)
```

### 推导逻辑

| 子工具 | 匹配条件 | 父节点查找 |
|--------|----------|-----------|
| `recall_context` | `args.memory_id` 非空 | 向前查找最近一条 search_memory 或 recall_context，其 result 包含该 memory_id |
| `recall_sources` | `args.memory_id` 非空 | 向前查找最近一条工具调用，其 result 或 args 包含该 memory_id |
| `web_fetch` | `args.url` 非空 | 向前查找最近一条 web_search，其 result 中的 citations/raw 包含该 url |

每条缩进 `depth × 20px`，depth ≥ 1 时行首显示 `├─` 树形连接线。

---

## 六、三种渲染路径

代码位置：[src/components/ChatArea.tsx:432-479](src/components/ChatArea.tsx#L432-L479)

```
消息是否含工具调用？
│
├── 无思考内容 (路径 A) ──→ 直接渲染 ToolCallBlock 列表（不套 ThinkBlock）
│
├── 有 reasoningSegments (路径 B，推荐) ──→ ThinkBlock 包裹
│                                            │
│                                            ├── reasoning 段 → 纯文本 div
│                                            └── tool_call 段 → ToolCallBlock（从 depthMap 取深度）
│
└── 旧版 thought_process + toolCalls (路径 C，兼容) ──→ ThinkBlock 包裹
                                                         │
                                                         ├── thought_process 纯文本
                                                         └── ToolCallBlock 列表
```

---

## 七、SSE 流式状态转换时序

### 工具调用生命周期（以 search_memory 为例）

```
时间线 →

onReasoning("让我搜索一下记忆...")
  │  → reasoningSegments: [{ type:'reasoning', text:'让我搜索一下记忆...' }]
  │
onToolCall("tc_1", "search_memory", { query: "成都火锅" })
  │  → 将当前缓冲 reasoning text 刷新为独立段
  │  → reasoningSegments.push({ type:'tool_call', toolCall: { status:'running', ... } })
  │  → UI 显示: 🧠 搜索记忆中...
  │
  ▼ (工具执行中...)
  │
onToolResult("tc_1", "search_memory", [{ memory_id:'m1', content:'...', score:0.92 }])
  │  → reasoningSegments 中对应 toolCall: status='done', result=[...]
  │  → UI 显示: 🧠 搜索到 3 条相关记忆  [展开箭头]
  │
onReasoning("根据记忆...")
  │  → reasoningSegments.push({ type:'reasoning', text:'根据记忆...' })
  │
onDone(...)
  │  → 保存最终 reasoningSegments
  │  → 标记 isStreaming = false
```

### 多步工具调用时序

```
onToolCall("tc_1", "search_memory", ...)   → UI 显示工具卡片
onToolResult("tc_1", ...)                   → 工具卡片更新为完成态
onReasoning("需要进一步...")                 → 追加推理文本
onStepStart(2)                              → 清空 raw_content，准备第二轮到
onToolCall("tc_2", "recall_context", ...)  → UI 显示嵌套工具卡片
onToolResult("tc_2", ...)                   → 更新为完成态
onReasoning("根据上下文...")                 → 最终推理
onDone(...)                                 → 完成
```

---

## 八、现有问题汇总（给 UI 设计师参考）

| # | 问题 | 影响 |
|---|------|------|
| 1 | 5 个 `tool-*` CSS 类名无定义，所有工具颜色一致 | 工具类型无法快速区分 |
| 2 | `pending`/`running` 态没有加载动画 | 用户等待时无视觉反馈 |
| 3 | `error` 态没有独立样式 | 工具失败时用户不知道 |
| 4 | `recall_context`、`recall_sources` 无展开详情 | 用户看不到被读取的对话和来源内容 |
| 5 | 展开箭头使用 `var(--color-primary)` 而非独立颜色变量 | 与主题主色耦合 |
| 6 | 工具卡片无边框/背景色区分 | 工具调用区域与思考文本视觉层级模糊 |
| 7 | 详情区域使用硬编码 `rgba(0,0,0,0.03)` 背景 | 暗色模式下可能不可见 |
| 8 | web_search 详情使用硬编码 `#16a34a` 绿色 | 不支持主题切换 |
