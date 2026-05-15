# AI Chat Windows 客户端 — 设计体系

> 基于方案B「侧边栏反相」高保真原型（暮山紫 Mu-Shan-Zi 色系）。
> 此文件是唯一的设计真源（source of truth），任何代码修改均需对齐本文档的 token 和规则。
> **禁止**在未更新本文档的情况下自行扩展颜色、字号或组件样式。

---

## 1. 视觉方向

- **定位**：Modern minimal + 暮山紫（Linear / Vercel 式克制 + CherryStudio 紫灰氛围）
- **关键词**：安静、精确、软件原生、信息密度、单 accent 点缀
- **平台**：Windows 桌面客户端
- **双模式**：全屏（1200×800）+ 小窗（900×680，可拖拽缩放）

---

## 2. 颜色令牌

所有颜色使用 CSS 变量定义在 `:root` 中。**禁止**在组件样式中硬编码十六进制色值。

| 变量 | 值 | 用途 |
|------|-----|------|
| `--sidebar-bg` | `#dadfef` | 侧边栏背景（略深于主区，形成左右对比） |
| `--bg` | `#e8edf7` | 窗口背景色 |
| `--surface` | `#f5f7fc` | 卡片、下拉菜单、标题栏背景 |
| `--chat-bg` | `#f5f7fc` | 聊天区背景 |
| `--fg` | `#3d4f70` | 前景/正文色 |
| `--muted` | `#6b7c9e` | 次要文字（标签、描述） |
| `--muted-soft` | `#8c9ab6` | 更弱的文字（placeholder、时间戳） |
| `--border` | `rgba(70, 85, 120, 0.1)` | 主分割线、卡片边框 |
| `--border-soft` | `rgba(70, 85, 120, 0.05)` | 弱分割线（行内元素） |
| `--accent` | `#5570b8` | **强调色**（主按钮、链接、选中态） |
| `--accent-hover` | `#4460a8` | accent 悬停态 |
| `--accent-dim` | `rgba(85, 112, 184, 0.1)` | accent 弱底色（hover 背景、选中背景） |
| `--accent-soft` | `rgba(85, 112, 184, 0.35)` | accent 中等底色（头像渐变） |
| `--user-bubble` | `#e8edf7` | 用户消息气泡底色 |
| `--ai-bubble` | `#dfe5f4` | AI 消息气泡底色 |
| `--hover-bg` | `#d2d9ed` | 列表/按钮 hover 背景 |
| `--active-bg` | `#cbd4e8` | 列表/按钮 active/按下背景 |
| `--success` | `#4a9e6e` | 成功/连接状态 |
| `--warn` | `#c9a43b` | 警告状态 |
| `--danger` | `#d4606a` | 危险/删除/关闭按钮 hover |

### accent 使用规则（硬性约束）

- **每个视觉区域最多使用 accent 1 次**（不包括 hover 状态下的文字变色）
- accent 的合法使用场景：
  - 主按钮（发送、新建、保存）
  - 选中/激活态（侧边栏项、设置导航、tab）
  - 链接文字
  - 隐私按钮「开」态
  - Toggle 开关「开」态
  - 代码片段内联底色
  - 思考过程展开箭头的 hover 态
- **禁止** accent 渐变背景、accent 大色块、accent 描边卡片

---

## 3. 字体系统

### 字体栈

| 变量 | 值 | 用途 |
|------|-----|------|
| `--font-display` | `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif` | 标题、侧边栏标签、logo |
| `--font-body` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif` | 正文、按钮、输入框 |
| `--font-mono` | `'Cascadia Code', 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'Consolas', monospace` | 代码块、时间戳、模型名、数字统计 |

### 字号与行高

| 角色 | 字号 | 字重 | 行高 | 字间距 |
|------|------|------|------|--------|
| 设置页标题 | 17px | 600 | 1.2 | `-0.01em` |
| 聊天标题 | 14px | 600 | 1.2 | `-0.01em` |
| 正文 | 14px | 400 | 1.65–1.7 | `0` |
| 对话标题 | 13px | 500 | 1.3–1.4 | `-0.01em` |
| 按钮文字 | 12px–13px | 500 | 1.5 | `0.01em–0.02em` |
| 辅助信息 | 11px–12px | 400 | 1.5 | `0.01em–0.02em` |
| **全大写标签** | 10px–11px | **600** | 1.5 | **`0.08em`（强制）** |
| 代码/等宽数字 | 10px–13px | 400 | — | `0.02em`，`font-variant-numeric: tabular-nums` |

### 全大写规则

所有全大写或小型大写字母的标签，必须设置 `letter-spacing: 0.06em–0.08em`，否则视为 bug。此类标签包括：
- 侧边栏「消息」标签
- 设置页 group label
- 供应商/模型标签
- 桌宠 section label
- 记忆统计标签

### 等宽数字规则

所有数字（时间戳、token 计数、上下文轮数、统计数字）必须使用等宽字体 `--font-mono` 并设置 `font-variant-numeric: tabular-nums`，确保数字列对齐。

---

## 4. 间距体系

| 变量 | 值 | 常用场景 |
|------|-----|----------|
| `--sp-1` | 4px | 图标与文字间距、紧凑间距 |
| `--sp-2` | 8px | 按钮之间间距、消息头间距 |
| `--sp-3` | 12px | 页面内边距、消息气泡间距 |
| `--sp-4` | 16px | 标准卡片内边距 |
| `--sp-5` | 20px | 消息列表 padding、设置页内容 |
| `--sp-6` | 24px | 设置页内容区大间距 |
| `--sp-8` | 32px | 页面级间距 |

---

## 5. 圆角令牌

| 变量 | 值 | 适用场景 |
|------|-----|----------|
| `--radius-sm` | 6px | 下拉选项、对话项、开关小球 |
| `--radius-md` | 8px | 按钮、输入框、消息气泡、设置项 |
| `--radius-lg` | 14px | 桌面窗口、卡片、弹窗 |
| `--radius-xl` | 18px | 大卡片、桌宠头像 |
| `--radius-full` | 9999px | 圆角按钮、标签、胶囊形状 |

---

## 6. 阴影与深度

四层阴影体系，自下而上递进：

| 层级 | CSS | 用途 |
|------|-----|------|
| **窗口** | `0 0 0 1px rgba(255,255,255,0.08), 0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(30,38,64,0.12), 0 24px 64px rgba(30,38,64,0.25), 0 40px 100px rgba(30,38,64,0.35)` | 桌面窗口投影 |
| **微阴影** | `0 1px 2px rgba(70, 85, 120, 0.04)` | 下拉按钮、输入框默认态 |
| **按钮** | `0 1px 3px rgba(85, 112, 184, 0.2)` → hover `0 2px 6px rgba(85, 112, 184, 0.35)` | 渐变主按钮、开关 on 态 |
| **弹窗** | `0 0 0 1px rgba(255,255,255,0.5), 0 8px 24px rgba(40, 50, 80, 0.08), 0 20px 56px rgba(40, 50, 80, 0.16)` | 模态弹窗 |
| **下拉菜单** | `0 4px 16px rgba(40, 50, 80, 0.08), 0 10px 32px rgba(40, 50, 80, 0.12)` | 下拉菜单、齿轮菜单 |

**规则**：仅窗口、按钮、弹窗、下拉菜单使用阴影。卡片、输入框默认无阴影，仅 `focus-within` 时出现微弱光环。

---

## 7. 过渡与动效

| 曲线 | 值 | 适用场景 |
|------|-----|----------|
| **标准缓出** | `cubic-bezier(0.32, 0.72, 0, 1)` | 窗口缩放、开关切换 |
| **入场弹性** | `cubic-bezier(0.16, 1, 0.3, 1)` | 消息出现、弹窗入场、下拉菜单 |
| **快速线性** | `0.1s–0.15s ease` | hover 状态切换、背景色变化 |

### 关键帧动画

| 动画 | 效果 | 用途 |
|------|------|------|
| `msg-in` | `opacity: 0→1, translateY(10px→0)` 0.3s | 新消息气泡入场 |
| `dot-bounce` | `translateY(0→-7px) + opacity(0.25→1)` 0.7s 无限 | 流式生成指示器 |
| `tc-pulse` | `opacity(0.35↔1)` 1.2s 无限 | 工具调用运行中圆点 |
| `fade-in` | `opacity(0→1)` 0.2s | 模态背板出现 |
| `modal-in` | `scale(0.95→1) + translateY(-12px→0)` 0.25s | 模态弹窗入场 |
| `menu-in` | `scale(0.95→1) + translateY(-4px→0)` 0.12–0.15s | 下拉菜单入场 |
| `badge-pop` | `scale(0.6→1) + opacity(0→1)` 0.3s | 桌宠「已领养」徽章出现 |

### 按钮交互反馈

- **悬停**：背景/边框色变 + `translateY(-1px)` + 阴影增强（仅主按钮）
- **点击**：`scale(0.96–0.97)` + 阴影消失
- **禁用**：`opacity: 0.25–0.3`，移除所有变换和阴影，`cursor: not-allowed`

---

## 8. 布局架构

### 8.1 桌面窗口

```
┌─────────────────────────────────────────────────┐
│  标题栏 (42px)                                    │
├──────────┬──────────────────────────────────────┤
│ 侧边栏   │ 聊天区 / 设置页                        │
│ 260px    │ flex: 1                               │
│ (小窗 →  │                                       │
│  212px)  │                                       │
└──────────┴──────────────────────────────────────┘
```

### 8.2 侧边栏结构

```
┌─── 助手选择器（下拉 + 齿轮 + 新建按钮） ───┐
├─── "消息" 标签 + 新对话按钮 ────────────────┤
├─── 对话列表（按助手分组）                    │
│    🤖 通用助手                                │
│      ├─ 对话标题 1                            │
│      └─ 对话标题 2                            │
│    📊 数据分析师                              │
│      └─ 对话标题 3                            │
├─── ⚙ 设置按钮 ──────────────────────────────┤
└──────────────────────────────────────────────┘
```

### 8.3 设置页结构

设置页**全屏覆盖**侧边栏+聊天区，自带左侧导航：

```
┌─── 设置导航 (260px) ───┬─── 设置内容 ──────────┐
│ 模型设置                 │ 标题栏                │
│ 长期记忆                 │ 内容区                │
│ 领养桌宠                 │                       │
│ (flex-grow)             │                       │
├─────────────────────────┤                       │
│ ← 返回                  │                       │
└─────────────────────────┴───────────────────────┘
```

- 设置导航宽度 = 主侧边栏宽度（`--sidebar-w`），保持视觉一致
- 导航底部固定「← 返回」按钮
- 设置内容区无独立的关闭/返回按钮（返回操作统一在左侧导航底部）

---

## 9. 组件规格

### 9.1 标题栏

| 属性 | 值 |
|------|-----|
| 高度 | 42px |
| 背景 | `--sidebar-bg` |
| 底边 | 1px `--border` |
| Logo | 24×24px，圆角 7px，渐变 `linear-gradient(135deg, var(--accent), #7b92ce)`，白字，投影 `0 1px 3px rgba(68,96,168,0.25)` |
| 标题文字 | 12px / 500 / `--font-display` / `--muted` |

**窗口控件**（Windows 原生风格，非 OS 色点）：

| 按钮 | 尺寸 | 图标 | Hover |
|------|------|------|-------|
| 最小化 | 46×32px | 下划线 SVG | `--hover-bg` |
| 最大化/窗口化 | 46×32px | 矩形框 SVG | `--hover-bg` |
| 关闭 | 46×32px | X SVG | `--danger` 背景 + 白色图标 |

---

### 9.2 消息气泡

| 属性 | AI 消息 | 用户消息 |
|------|---------|----------|
| 最大宽度 | 720px | 720px |
| 背景 | `--ai-bubble` (#dfe5f4) | `--user-bubble` (#e8edf7) |
| 圆角 | `--radius-lg` (14px) | `--radius-lg` (14px) |
| 内边距 | 14px 18px | 14px 18px |
| 字号/行高 | 14px / 1.7 | 14px / 1.7 |
| 头像 | 渐变 accent 底 + accent 色字，32×32px | 纯色 active-bg 底 + fg 色字，32×32px |
| 对齐 | 靠左 | 靠右（`flex-end`） |

### 9.3 思考气泡（.think-block）

| 属性 | 值 |
|------|-----|
| 边框 | 1px `--border` |
| 圆角 | `--radius-md` (8px) |
| 背景 | `--sidebar-bg` |
| 切换按钮 | 12px / 500 / `--muted` |
| 展开内容 | 13px / 斜体 / `--muted` |
| 内容区边框 | 1px `--border` 上边 |

### 9.4 工具调用（工具调用显示在思考气泡中）

**五种工具类型：**

| 工具 | Emoji | 运行中文案 | 完成文案 |
|------|-------|-----------|----------|
| `search_memory` | 🧠 | 搜索记忆中... | 搜索到 N 条相关记忆 |
| `recall_context` | 💬 | 读取原始对话... | 读取了 N 轮原始对话 |
| `recall_sources` | 📎 | 读取附件/网页... | 读取了 N 个来源 |
| `web_search` | 🌐 | 搜索网页中... | 搜索到 N 条网页结果 |
| `web_fetch` | 📄 | 读取网页中... | 读取了 {页面标题} |

**状态显示规则：**

- **运行中**：emoji + 动作文案 + 脉冲圆点（`tc-pulse-dot`），文字色 `--muted-soft`
- **已完成**：emoji + 结果文案 + 耗时（如 `1.2s`）+ 展开箭头（如结果可展开）
- **可展开**：`clickable` 类，hover 显示 `--hover-bg`

**嵌套规则：**

- 子调用以 `tc-nested` 包裹：左侧 22px 缩进 + 1px `--border` 竖线 + 8px 内边距
- 父子关系：`search_memory → recall_context → recall_sources`，`web_search → web_fetch`（URL 匹配时）

**展开详情样式：**

| 详情类型 | 样式 |
|----------|------|
| 记忆列表 | 记忆内容 + 相似度百分比（右对齐，`--font-mono`，`--accent` 色） |
| 网页搜索结果 | 编号 + 标题（`--accent` 色，500 字重）+ 摘要（11px，`--muted-soft`） |
| 网页抓取 | 标题（`--accent` 色）+ 正文（12px，最大高度 180px，可滚动） |

### 9.5 代码块

| 属性 | 值 |
|------|-----|
| 背景 | `#2e3858`（深色） |
| 文字色 | `#e2e8f4` |
| 字体 | `--font-mono`，13px，tab-size: 2 |
| 内边距 | 14px 16px |
| 圆角 | `--radius-md` |
| 内联代码 | `--accent-dim` 底 + `--accent` 字色，2px 5px padding，3px 圆角 |

### 9.6 输入容器（一体化）

| 属性 | 值 |
|------|-----|
| 边框 | 1px `--border` |
| 圆角 | `--radius-lg` (14px) |
| 背景 | `--surface` |
| focus-within | 边框变 `--accent` + 背景变白 + 聚焦光环 `0 0 0 3px rgba(85,112,184,0.06)` |
| 文本域 | 无边框无背景，14px/1.65，min-height: 68px，max-height: 50vh |
| 工具栏 | flex row，内边距 6px 12px 12px |

**工具栏从左到右：** 深度思考 → 联网搜索 → （spacer）→ 上下文轮数 → 上传 → 发送/停止

### 9.7 控制按钮（.control-toggle）

| 状态 | 样式 |
|------|------|
| 默认 | 1px `--border`，`--radius-full`，12px/500，`--muted` |
| Hover | 边框 `--accent`，文字 `--accent` |
| **ON** | 背景 `--accent` 实心 + 白色文字 + 投影，无描边 |

### 9.8 发送按钮

| 属性 | 值 |
|------|-----|
| 尺寸 | 36×36px |
| 圆角 | `--radius-md` |
| 背景 | `linear-gradient(135deg, var(--accent), #6a82ce)` |
| 投影 | `0 2px 6px rgba(85,112,184,0.25)` |
| Hover | `scale(1.04)` + 投影增强 |
| Active | `scale(0.96)` |
| 禁用 | `opacity: 0.25`，无变换无投影 |

### 9.9 按钮体系

| 类型 | 类名 | 样式 |
|------|------|------|
| **主按钮** | `.btn-primary` | 渐变 accent 135deg + 白字 + 投影 |
| **次按钮** | `.btn-secondary` | 透明底 + `--muted` 字 + `--border` 描边，hover 变 accent 调 |
| **危险按钮** | `.btn-danger` | 透明底 + `--danger` 字 + `--danger` 描边，hover 实心红色 + 白字 |
| **侧边栏按钮** | `.sidebar-btn` | 32×32px，`--radius-md`，`--border` 描边 |
| **侧边栏主按钮** | `.sidebar-btn.primary` | 渐变 accent 底 + 白字 + 投影 |
| **胶囊按钮** | `.control-toggle` `.provider-tab` `.pet-subtab` | `--radius-full`，hover 变 accent 边框 |

所有按钮的 padding 为 9px 18px（标准）或按需调整。

### 9.10 Toggle 开关

| 属性 | 值 |
|------|-----|
| 尺寸 | 42×24px |
| 圆角 | 12px（`--radius-full` 一半） |
| 轨道 | `off`: `--border` / `on`: `--accent` + 微投影 |
| 小球 | 20×20px 白色圆 + 投影，弹簧动画 `cubic-bezier(0.32, 0.72, 0, 1)` 250ms |
| 交互 | 点击轨道任意位置切换 |

### 9.11 隐私 Badge

| 属性 | 值 |
|------|-----|
| 形状 | 胶囊（`--radius-full`） |
| 内边距 | 4px 12px |
| 文字 | 固定「隐私」两字 + 左侧 6px 圆点 |
| 默认态 | `--chat-bg` 底 + `--border` 描边 + `--muted` 字 |
| ON 态 | `--accent` 实心底 + 白色字 + 投影 |
| 字体 | 11px / 600 / `letter-spacing: 0.03em` |

### 9.12 模态弹窗

| 属性 | 值 |
|------|-----|
| 宽度 | 520px（确认弹窗 420px） |
| 圆角 | `--radius-xl` (18px) |
| 背板 | `rgba(50, 58, 85, 0.4)` + `backdrop-filter: blur(2px)` |
| 入场 | `modal-in`：`scale(0.95→1)` + `translateY(-12px→0)`，250ms |

| 弹窗类型 | 用途 | 字段 |
|----------|------|------|
| AssistantModal | 新建/编辑助手 | 名称、emoji、供应商、模型、系统提示词 |
| ConfirmModal | 删除确认 | 标题 + 消息 + 取消/删除按钮 |
| ProviderModelModal | 添加供应商/模型 | 单输入框 + 取消/添加按钮 |

### 9.13 下拉菜单与齿轮菜单

| 属性 | 值 |
|------|-----|
| 圆角 | `--radius-md` |
| 内边距 | 4px |
| 入场 | `menu-in`：`scale(0.95→1)` + `translateY(-4px→0)`，120–150ms |
| 选项 height | 选项 height: 36–38px（8px padding 上下 + 20px 内容） |
| 危险选项 | `.gear-menu-item.danger`：hover 红色浅底 + 红色字 |

### 9.14 对话列表项

| 属性 | 值 |
|------|-----|
| 高度 | ~38px |
| 内边距 | 8px 10px |
| 圆角 | `--radius-sm` |
| 默认 | 无背景 |
| Hover | `--hover-bg` |
| **Active** | `--accent-dim` 底 + `--accent` 字色 + **左侧 3px accent 色指示条** |
| 指示条 | `::before` 伪元素，`width: 3px`，`border-radius: 0 2px 2px 0` |

### 9.15 模型设置（settings-content-body 内）

**供应商区（上半部）：**

- 添加按钮（`+ 添加供应商`）在左上角，`--radius-full` 胶囊形，虚线 accent 描边
- 「供应商」标签紧随按钮右侧
- 供应商以胶囊 tab 展示，每个 tab 显示名称 + 模型数量 badge
- 选中 tab：accent 实心底 + 白字 + 投影

**模型区（下半部）：**

- 显示 `{供应商名} — 模型列表` 标签 + 添加模型按钮
- 模型以列表项展示：名称（13px/500）+ ID（11px/mono/muted），带微弱背景和边框
- 未选中供应商时显示引导提示

### 9.16 长期记忆设置

| 元素 | 说明 |
|------|------|
| 自动提取记忆 | Toggle 开关 + 描述文字 |
| 记忆统计 | 2 列网格卡片，数字大号 mono accent 色 |
| 个人信息 | 单文本域（textarea），无新增按钮，placeholder 引导 |

### 9.17 领养桌宠

**子 Tab 切换：**「🎨 内置桌宠」/「📥 导入桌宠」，选中态 = accent 实心胶囊。

**内置桌宠：** 6 个卡片网格（`grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`），每卡片含 72px 头像（渐变圆角方块 + emoji）、名称、描述。选中态：`box-shadow: 0 0 0 2px var(--accent)` + accent 浅底 + 右上角「✓ 已领养」胶囊 badge。

**导入桌宠：**

| 元素 | 说明 |
|------|------|
| 拖拽区 | 2px 虚线边框，大图标 + 标题 + 说明 + 格式提示。hover/drag-over 时边框变 accent + accent 浅底。点击触发 file input |
| 已导入列表 | 同款卡片网格，标题「已导入的桌宠」 |
| 开源社区 | 3 个链接（DesktopPetHub / PetMarket / GitHub Awesome-DesktopPets），`--accent` 色文字 |

### 9.18 滚动条

| 属性 | 值 |
|------|-----|
| 宽度 | 5px |
| 轨道 | 透明 |
| 滑块 | `--border` 色，圆角 3px |
| 滑块 hover | `--muted-soft` 色 |

### 9.19 聚焦态

| 元素 | 样式 |
|------|------|
| 输入框（`.form-input:focus`） | 边框变 `--accent` + 背景变白 + `box-shadow: 0 0 0 3px rgba(85,112,184,0.06)` |
| 文本域（`.input-container:focus-within`） | 同上 + 整框边框变 `--accent` |
| 按钮（`:focus-visible`） | `box-shadow: 0 0 0 3px rgba(85,112,184,0.15)` |
| 选中文字（`::selection`） | `--accent-dim` 底 + `--accent` 字色 |

---

## 10. 设计约束（Do's and Don'ts）

### ✅ 必须遵守

- **颜色**：所有色值使用 CSS 变量。仅在 `:root` 中定义，组件中永远不写硬编码十六进制。
- **accent 克制**：每屏最多 1 个 accent 强调元素。发送按钮、一个开关、一个选中态 — 三者不会同时出现。
- **全大写**：所有全大写标签必须设置 `letter-spacing: 0.06em–0.08em`。
- **等宽数字**：所有数字（时间、统计、token）使用 `--font-mono` + `tabular-nums`。
- **阴影层级**：仅窗口、按钮、弹窗、下拉菜单使用阴影。卡片和输入框无阴影。
- **过渡**：所有交互状态变化（hover、active、focus、选中）必须设 transition。
- **消息宽度**：AI 和用户消息的 max-width 必须相等（720px），不可一方窄一方宽。

### ❌ 禁止

- 渐变背景（按钮渐变除外）
- 紫色/紫罗兰色大面积背景
- 装饰性 emoji（功能性 emoji 如 🧠🌐📎 除外）
- 卡片左边框彩色 accent 条（对话列表项左侧指示条除外）
- Inter / Roboto / Arial 作为字体首选（系统栈 → Segoe UI → SF Pro）
- 手绘 SVG 插图
- 假数字/假占位符（无法获取真值时用 `—` 或置空）
- 硬编码 `left`/`right` CSS 属性（使用逻辑属性或 flex/grid 对齐方式）
- 消息气泡加阴影或描边

---

## 11. 文件引用

此文件描述的设计体系来自以下原型文件：
- **主原型**：`ai-chat-windows-client-proto-v5-pet.html`
- **工具调用示例**：`tool-calls-demo.html`
- **功能清单**：`mp3inaup-功能清单与关联关系.md`

当需求涉及视觉修改时，必须先在本文档中更新对应的 token/规则，再修改代码。
