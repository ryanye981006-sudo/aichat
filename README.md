# aichat

基于 CherryStudio 设计系统的 AI 聊天应用，支持多模型提供商、RAG 知识库、全局长期记忆。

## 核心功能

- **智能助手管理** — 创建/编辑/删除助手，自定义提示词、模型、温度、上下文轮数
- **多模型提供商** — 预设 DeepSeek / 通义千问 / 智谱 GLM / Moonshot / Ollama / OpenAI，支持自定义 OpenAI 兼容 API
- **RAG 知识库** — 上传 PDF/Word/Markdown/TXT 文档，自动分块、向量化、语义检索
- **全局记忆** — 自动从对话中提取用户偏好和事实，SHA256 + 余弦相似度双重去重

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite |
| UI | Ant Design 5 + Tailwind CSS 4 + CherryStudio 设计 Token |
| 后端 | Node.js + Express |
| 数据库 | better-sqlite3 (WAL 模式) |
| LLM 协议 | OpenAI 兼容 (`/v1/chat/completions`, `/v1/embeddings`) |

## 项目结构

```
aichat/
├── server/src/           # 后端
│   ├── index.ts          # Express 入口
│   ├── db/               # 数据库连接 + 迁移
│   ├── routes/           # REST API (assistants/chat/memory/knowledge...)
│   ├── services/         # 业务逻辑 (AiService/MemoryService/KnowledgeService...)
│   └── utils/            # 工具函数 (分块/哈希/向量/提示词模板)
├── src/                  # 前端
│   ├── components/       # React 组件
│   ├── services/         # API 调用封装
│   ├── styles/           # CherryStudio 设计系统 (tokens/tailwind/animations)
│   ├── providers/        # ThemeProvider + AntdThemeProvider
│   └── store/            # Context + useReducer 状态管理
└── starter-template/     # CherryStudio 设计系统参考
```

## 快速启动

**环境要求:** Node.js 18+

```bash
# 1. 安装依赖
npm install

# 2. 启动后端 API 服务 (端口 3001)
npm run dev:server

# 3. 启动前端开发服务器 (端口 3000)
npm run dev
```

前端自动代理 `/api` 请求到后端，打开 http://localhost:3000 即可使用。

## 使用指南

1. 进入**设置 → 模型设置**，选择一个预设提供商，填入 API Key
2. 点击"拉取模型"自动获取可用模型列表，或手动添加模型
3. 创建**助手**，在模型设置中选择刚配置的提供商和模型
4. 开始对话 — 支持 Markdown 渲染和 `<think>` 深度思考解析

### RAG 知识库

1. 进入**设置 → RAG 知识库**，新建知识库
2. 上传 PDF/Word/Markdown/TXT 文件
3. 系统自动进行文档加载 → 分块 → 向量化
4. 在助手中关联知识库，对话时自动检索相关内容

### 全局记忆

1. 进入**设置 → 全局记忆**，开启记忆开关
2. 配置记忆提取的 LLM 模型和嵌入模型
3. 对话结束后系统自动提取用户偏好和事实
4. 后续对话自动注入相关记忆上下文

## API 接口

Base: `/api`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/assistants` | 助手列表/创建 |
| GET/PUT/DELETE | `/assistants/:id` | 助手详情/更新/删除 |
| GET/POST | `/conversations` | 对话列表/创建 |
| PATCH/DELETE | `/conversations/:id` | 更新标题/删除 |
| GET | `/messages?conversationId=` | 获取消息 |
| POST | `/chat/completions` | SSE 流式聊天 |
| GET/POST | `/providers` | 提供商列表/创建 |
| POST | `/providers/:id/fetch-models` | 自动拉取模型 |
| GET/POST | `/models` | 模型列表/添加 |
| GET/PUT | `/memory/settings` | 记忆设置 |
| GET/POST | `/memory/search` | 记忆列表/向量搜索 |
| GET/POST | `/knowledge` | 知识库列表/创建 |
| POST | `/knowledge/:id/documents` | 上传文档 |
| POST | `/knowledge/:id/search` | RAG 检索 |
