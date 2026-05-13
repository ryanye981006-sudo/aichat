# AIChat RAG 模块优化方案

## Context

AIChat 的 RAG 知识库模块当前基于 SQLite JSON 列做暴力向量搜索（O(n) 全表扫描 + 内存余弦相似度），缺少重排序、查询重写、嵌入缓存等关键能力。通过分析 AgentScope（阿里开源智能体框架）和 CherryStudio（成熟桌面 AI 客户端）的 RAG 实现，提炼出以下优化方向。

**目标**: 在不引入外部服务依赖的前提下，显著提升检索质量、处理性能和用户体验。

---

## 优化方案（按优先级分 4 个阶段）

---

## Phase 1: 快速收益（嵌入缓存 + 查询重写 + 修复缺陷）

### 1.1 嵌入缓存（借鉴 AgentScope 的 FileEmbeddingCache）

**技术方案**: 文件系统缓存，SHA-256 哈希作键，JSON 文件存储向量数组
- 缓存 key = `sha256(model:input:dimensions)`
- 存储位置: `data/embedding_cache/` 目录
- 淘汰策略: LRU，基于文件修改时间，最大 500MB 或 10000 条
- 缓存命中时记录 `source: "cache"` 用于监控

**修改文件**:
- 新增 `server/src/services/EmbeddingCache.ts`
- 修改 `server/src/services/EmbeddingService.ts` — 查询前检查缓存，嵌入后写入缓存

### 1.2 查询重写（借鉴 AgentScope 的 enable_rewrite_query + CherryStudio 的意图分析）

**技术方案**: 在检索前用 LLM 将用户模糊查询改写为更精确的检索查询
- Prompt 模板: "将以下用户问题重写为更具体、更简洁的知识库检索查询。只输出重写后的查询，不要解释。"
- 使用轻量模型（如 GPT-3.5-Turbo 或用户配置的默认模型）
- 重写失败时回退到原始 query（借鉴 CherryStudio 的降级策略）
- 可在知识库配置中开关

**修改文件**:
- 新增 `server/src/utils/rewriteQuery.ts` — 查询重写 prompt 和逻辑
- 修改 `server/src/services/KnowledgeService.ts` — search() 方法中插入重写步骤
- 修改 `server/src/db/migrations/002_rag_enhancements.sql` — knowledge_bases 表新增 `enable_query_rewrite INTEGER DEFAULT 1`

### 1.3 改进分块策略（借鉴 AgentScope 三种分块 + CherryStudio RecursiveCharacterTextSplitter）

**技术方案**: 增强现有 chunk.ts，支持三种分块模式
- `char`: 当前强制长度截断（保留 overlap）
- `paragraph`: 按段落（`\n\n`）分割，段落过长时递归降级
- `sentence`: 按中英文标点分割（增强现有逻辑，补充中文标点覆盖）
- 新增 `separator_order`: 先段落 → 再句子 → 最后字符（LangChain 递归风格）
- 保持 Markdown 标题结构感知（遇到 `#` 开头时作为分隔点）

**修改文件**:
- 修改 `server/src/utils/chunk.ts` — 重构为多种策略
- 修改 `server/src/db/migrations/002_rag_enhancements.sql` — knowledge_bases 表新增 `chunk_strategy TEXT DEFAULT 'paragraph'`

### 1.4 修复现有多知识库搜索缺陷

**问题**: `KnowledgeService.search()` 只使用第一个知识库的嵌入配置，多知识库使用不同嵌入模型时会出错。

**修复**: 按嵌入模型对知识库分组，每组使用对应模型分别搜索，最后合并排序。

**修改文件**:
- 修改 `server/src/services/KnowledgeService.ts` — search() 按嵌入模型分组处理

### 1.5 增强记忆提取鲁棒性

**问题**: LLM 返回的 JSON 通过 `result.match(/\[[\s\S]*\]/)` 正则提取，格式偏差就失败。

**修复**:
- 使用更鲁棒的 JSON 提取：找到第一个 `[` 和最后一个 `]` 之间的内容
- 添加 JSON Schema 校验，过滤不符合格式的条目
- 提取失败时记录详细日志（包含原始 LLM 输出），不静默丢弃

**修改文件**:
- 修改 `server/src/services/MemoryService.ts`

### 1.6 新增嵌入缓存统计与监控

**新增 API**: `GET /api/knowledge/cache-stats` — 返回缓存命中率、条目数、占用空间
- 便于用户了解缓存效果

---

## Phase 2: 检索质量提升（重排序 + 预处理）

### 2.1 重排序管线（借鉴 CherryStudio 的 Reranker 策略模式）

**技术方案**: 
- 抽象基类 `BaseReranker`，策略实现：OpenAI-compatible `/rerank`、Jina、TEI
- 默认使用 OpenAI-compatible rerank API（与现有 provider 体系一致）
- 重排序在向量检索后、topK 截断前执行
- 可配置开关，失败时降级到原始分数排序

**修改文件**:
- 新增 `server/src/reranker/BaseReranker.ts` — 抽象基类
- 新增 `server/src/reranker/OpenAIReranker.ts` — OpenAI 兼容实现
- 新增 `server/src/reranker/JinaReranker.ts` — Jina reranker
- 新增 `server/src/reranker/RerankerFactory.ts` — 工厂
- 修改 `server/src/services/KnowledgeService.ts` — search() 中插入重排序步骤
- 修改 `server/src/db/migrations/002_rag_enhancements.sql`:
  - `knowledge_bases` 新增 `rerank_provider_id TEXT`、`rerank_model_id TEXT`、`enable_rerank INTEGER DEFAULT 0`

### 2.2 文档预处理管线（借鉴 CherryStudio 的 PreprocessProvider）

**技术方案**: 
- 抽象基类 `BasePreprocessor`，默认实现为本地 PDF 到文本转换
- 可选外部预处理 provider（如 Doc2x、Mistral OCR API）
- 预处理结果缓存到 `data/preprocess/` 目录
- PDF 预处理 → Markdown 输出 → 再进行分块嵌入

**修改文件**:
- 新增 `server/src/preprocess/BasePreprocessor.ts`
- 新增 `server/src/preprocess/DefaultPreprocessor.ts` — 使用现有 pdf-parse
- 新增 `server/src/preprocess/PreprocessorFactory.ts`
- 修改 `server/src/services/KnowledgeService.ts` — processDocument() 中插入预处理步骤
- 修改 `server/src/db/migrations/002_rag_enhancements.sql`:
  - `knowledge_bases` 新增 `preprocess_provider TEXT DEFAULT 'default'`

### 2.3 扩展文档格式支持

**新增格式**:
- EPUB（借鉴 CherryStudio 的 epubLoader）
- HTML 改进（使用 `cheerio` 或 `node-html-parser` 替代正则）
- CSV/TSV 表格解析

**修改文件**:
- 修改 `server/src/services/LoaderService.ts`
- 新增 `npm` 依赖: `cheerio`（用于 HTML 解析）

---

## Phase 3: 架构升级（向量数据库 + 并发控制）

### 3.1 向量数据库替换

**技术选型**: **LanceDB** (`@lancedb/lancedb`)
- 理由: 嵌入式、无需服务器、原生 Node.js 绑定、支持索引（IVF-PQ）、Rust 底层高性能
- 备选: **LibSqlDb**（CherryStudio 方案，SQLite 兼容，但向量搜索能力有限）

**迁移方案**:
- 保留 `knowledge_chunks` 表（存储内容元数据），新增 `vector_store` 抽象层
- 首次启动时自动将现有 JSON 向量迁移到 LanceDB
- `VectorStoreBase` 抽象类，LanceDB 为实现
- 未来可扩展其他后端

**修改文件**:
- 新增 `server/src/vectorstore/VectorStoreBase.ts` — 抽象接口
- 新增 `server/src/vectorstore/LanceDBStore.ts` — LanceDB 实现
- 新增 `server/src/vectorstore/migrate.ts` — 迁移脚本
- 修改 `server/src/services/KnowledgeService.ts` — 使用 VectorStore 替代直接 SQL
- 修改 `server/src/services/MemoryService.ts` — 使用 VectorStore
- 新增 `npm` 依赖: `@lancedb/lancedb`

### 3.2 工作负载感知并发控制（借鉴 CherryStudio 的 processingQueueHandle）

**技术方案**:
- 最大并发处理数: 10 个文档
- 最大总文件大小: 100MB
- 任务队列: 待处理 / 处理中 / 已完成 / 失败
- Promise 递归调度器

**修改文件**:
- 新增 `server/src/services/ProcessingQueue.ts` — 队列管理
- 修改 `server/src/services/KnowledgeService.ts` — processDocument() 使用队列
- 新增 API: `GET /api/knowledge/queue-status` — 查看处理队列

---

## Phase 4: 前端增强

### 4.1 知识库配置 UI 完善

当前用户创建知识库时只能输入名称，其他参数全部使用默认值。需增加：
- 嵌入模型选择（provider + model）
- 分块策略和参数（chunkSize、chunkOverlap、chunkStrategy）
- 搜索参数（topK、threshold）
- 查询重写开关
- 重排序配置（provider、model、开关）

**修改文件**:
- 修改 `src/components/SettingsArea.tsx` — 扩展 AddKbModal/EditKbModal

### 4.2 引用来源展示

检索到的知识库内容在聊天回答中显示引用标记（类似 CherryStudio 的 CitationBlock）
- 每条引用显示来源文件名和相似度分数
- 点击可展开查看完整内容

**修改文件**:
- 新增 `src/components/CitationBlock.tsx`
- 修改 `src/components/ChatArea.tsx` — 消息气泡中渲染引用

### 4.3 知识库搜索测试界面

在知识库详情页增加"搜索测试"功能，输入 query 查看检索结果和分数

**修改文件**:
- 修改 `src/components/SettingsArea.tsx` — 知识库列表增加搜索测试入口
- 新增 API: `POST /api/knowledge/:id/search-test` — 返回检索结果（含分数）

---

## 修改文件清单汇总

### 新增文件
| 文件 | 阶段 |
|------|------|
| `server/src/services/EmbeddingCache.ts` | Phase 1 |
| `server/src/utils/rewriteQuery.ts` | Phase 1 |
| `server/src/reranker/BaseReranker.ts` | Phase 2 |
| `server/src/reranker/OpenAIReranker.ts` | Phase 2 |
| `server/src/reranker/JinaReranker.ts` | Phase 2 |
| `server/src/reranker/RerankerFactory.ts` | Phase 2 |
| `server/src/preprocess/BasePreprocessor.ts` | Phase 2 |
| `server/src/preprocess/DefaultPreprocessor.ts` | Phase 2 |
| `server/src/preprocess/PreprocessorFactory.ts` | Phase 2 |
| `server/src/vectorstore/VectorStoreBase.ts` | Phase 3 |
| `server/src/vectorstore/LanceDBStore.ts` | Phase 3 |
| `server/src/vectorstore/migrate.ts` | Phase 3 |
| `server/src/services/ProcessingQueue.ts` | Phase 3 |
| `server/src/db/migrations/002_rag_enhancements.sql` | Phase 1-2 |
| `src/components/CitationBlock.tsx` | Phase 4 |

### 修改文件
| 文件 | 变更内容 |
|------|----------|
| `server/src/services/KnowledgeService.ts` | 查询重写、重排序、分组搜索、向量存储、预处理、队列 |
| `server/src/services/MemoryService.ts` | JSON 解析鲁棒性、向量存储 |
| `server/src/services/EmbeddingService.ts` | 嵌入缓存集成 |
| `server/src/services/LoaderService.ts` | 新增 EPUB/CSV 支持、HTML 解析改进 |
| `server/src/utils/chunk.ts` | 多策略分块 |
| `server/src/routes/knowledge.ts` | 缓存统计 API、搜索测试 API、队列状态 API |
| `server/src/routes/chat.ts` | 引用信息传递 |
| `src/components/SettingsArea.tsx` | 知识库配置 UI 完善、搜索测试 |
| `src/components/ChatArea.tsx` | 引用块渲染 |
| `src/components/AssistantModal.tsx` | 知识库关联 UI |
| `src/services/api.ts` | 新增 API 调用 |
| `src/types/index.ts` | 新增类型定义 |

---

## 实施顺序

```
Phase 1 (1-2天):
  1.1 嵌入缓存 ──┐
  1.3 改进分块    ├── 可并行
  1.4 多KB搜索修复 ──┘
  1.2 查询重写 ← 依赖 LLM 服务正常
  1.5 记忆提取鲁棒性 ← 独立

Phase 2 (1-2天):
  2.1 重排序管线 ← 依赖 1.2（共用 provider 体系）
  2.2 文档预处理 ──┐
  2.3 扩展文档格式  ├── 可并行
  (Phase 1 完成后开始)

Phase 3 (2-3天):
  3.1 向量数据库 ← 核心变更，需充分测试
  3.2 并发控制 ← 依赖 3.1

Phase 4 (1-2天):
  4.1 知识库配置 UI ← 依赖 Phase 1-3 的后端参数
  4.2 引用展示 ← 依赖 Phase 1 检索结果结构
  4.3 搜索测试 UI ← 独立
```

## 技术选型理由

| 选择 | 理由 |
|------|------|
| **LanceDB** 作向量数据库 | 嵌入式、无需服务器、Rust 底层、Node.js 原生绑定、IVF-PQ 索引 |
| **文件系统嵌入缓存** | 零依赖、SHA-256 确定性、.json 文件简单可调试 |
| **策略模式**（重排序/预处理/分块） | 借鉴 CherryStudio+AgentScope，易扩展、职责清晰 |
| **RecursiveCharacterTextSplitter 风格分块** | LangChain 验证过的成熟方案，覆盖中英文 |
| **保留 better-sqlite3** | 继续作为元数据和内容存储，LanceDB 只负责向量索引 |

## 风险点

1. **LanceDB Node.js SDK 成熟度**: 相对较新，需验证在 Windows 上的稳定性。备选方案：继续使用 SQLite + 内存搜索，仅增加分块级索引减少扫描量。
2. **嵌入模型维度变化**: 更换嵌入模型时维度可能不同（如 1536 → 3072），需支持迁移或标记不兼容。
3. **缓存失效**: 嵌入模型或 provider 变更时需清理缓存。
4. **查询重写增加延迟**: 每次搜索多一次 LLM 调用（约 500ms-1s），需权衡体验。

## 验证方式

1. 启动前后端后，上传 PDF/DOCX/TXT 文档到知识库
2. 观察文档处理流程（预处理 → 分块 → 嵌入 → 缓存写入）
3. 在聊天中发送相关问题，验证检索结果质量和引用展示
4. 检查嵌入缓存命中率（通过缓存统计 API）
5. 切换不同分块策略，对比检索结果
6. 开启/关闭重排序，对比回答准确性
7. 批量上传多个大文档，验证并发控制和队列状态
