# DashScope API 回归测试报告

> 测试环境：`https://dashscope.aliyuncs.com/compatible-mode` + sk-9c8dd90c4386426db75c9833b6ec8b8e
> 测试模型：qwen3.5-plus / qwen3.6-plus / qwen-plus
> 测试时间：2026-05-03
> 测试方式：API 直接调用 + SSE 流式验证

---

## 测试通过项

| # | 测试项 | 验证方式 | 结果 |
|---|--------|----------|------|
| 1 | fetch-models | `POST /providers/:id/fetch-models` → 返回 239 个模型，按厂商分组 | PASS |
| 2 | 单模型连通性测试 | `POST /providers/:id/test` {qwen3.5-plus, 754ms} | PASS |
| 3 | 批量健康检测 | `POST /providers/:id/test-models` {3个全部通过} | PASS |
| 4 | 助手创建/编辑 | CRUD 正常 | PASS |
| 5 | 对话创建 | 自动标题、消息列表正常 | PASS |
| 6 | SSE 流式聊天 | meta/token/reasoning/done 事件完整、metrics 有值 | PASS |
| 7 | thinking_mode=disabled | 无 reasoning 事件，thoughtProcess: null | PASS |
| 8 | thinking_mode=enabled | reasoning 事件正常输出 | PASS |
| 9 | /no_think 后缀 | disabled + qwen 模型时生效，直接给出答案 | PASS |
| 10 | 重新生成 | regenerate 返回新 message_id + metrics | PASS |
| 11 | Token 用量 | promptTokens/completionTokens/totalTokens/ttftMs/tokensPerSecond | PASS |
| 12 | 中文消息存储 | 数据库读写均正确（curl shell 参数的中文乱码系工具层面） | PASS |

---

## Bug 1（严重）：模型验证缓存导致校验失效

### 现象

`POST /providers/:id/validate-model` 验证不存在的模型名（`qq`、`nonexistent-model-xyz`），全部返回 `valid: true`。

```
curl validate-model { "model_name": "qq" }        → { "valid": true, "time": 262 }
curl validate-model { "model_name": "xyz-none" }  → { "valid": true, "time": 160 }
```

### 影响

用户通过"+"按钮添加模型时，输入任何不存在的模型名都会通过验证，无效模型被写入数据库，直到聊天时才暴露"模型不存在"错误，前置校验完全失效。

### 根因

[server/src/services/AiSdkService.ts:69](server/src/services/AiSdkService.ts#L69) — `createModel` 缓存 key 使用 `model.id`：

```ts
function createModel(provider: any, model: any) {
  const cacheKey = `${provider.id}:${model.id}`  // model.id 为 undefined 时 → "providerId:undefined"
  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey)  // 返回已缓存的模型实例
  }
  ...
}
```

[server/src/services/AiSdkService.ts:318](server/src/services/AiSdkService.ts#L318) — `validateModel` 调用时只传 `{ name }`，无 `id`：

```ts
const sdkModel = createModel(provider, { name: modelName })
// cacheKey = "be93a445...:undefined"
```

同一供应商的所有 validateModel 调用共享 `providerId:undefined` 这个 key。首次验证通过的模型（如 qwen3.6-flash）被缓存后，后续任何模型名（如 `qq`）都会复用这个缓存实例，导致验证永远返回 `valid: true`。

### 修复方案

```diff
- const cacheKey = `${provider.id}:${model.id}`
+ const cacheKey = `${provider.id}:${model.id || model.name}`
```

**1 行改动**。`testModel` 和 `chatStream` 使用的 model 都有 `id`（从数据库查出），缓存逻辑不受影响。

### 影响文件

- `server/src/services/AiSdkService.ts` — 第 69 行

---

## 未测试项（需在浏览器中手动验证）

以下 UI 交互功能无法通过 curl 验证，需要打开前端实际操作：

| # | 测试项 | 位置 |
|---|--------|------|
| 1 | FetchModelsModal 分组筛选/搜索/全选/批量添加 | 设置 → 模型 → 获取模型列表 |
| 2 | AddModelModal 验证失败红色中文错误显示 | 设置 → 模型 → + 按钮 |
| 3 | 供应商删除按钮 → 弹窗二次确认 | 设置 → 模型 → 垃圾桶图标 |
| 4 | 单模型测试弹窗下拉选模型 + 结果展示 | 设置 → 模型 → 测试按钮 |
| 5 | 批量健康检测并发实时更新（逐个变色） | 设置 → 模型 → Activity 图标 |
| 6 | Emoji Picker 更多选择 | 新建/编辑助手弹窗 |
| 7 | 思考模式下拉菜单 + 帮助文字 | 新建/编辑助手 → 模型设置 |
| 8 | ThinkBlock 折叠/展开 | 聊天区 → 思考过程 |
| 9 | 停止生成按钮 + 红色中止气泡 | 聊天区 → 发送消息时点击停止 |
| 10 | 复制按钮 2 秒 Check 反馈 | 聊天区 → AI 消息下方 |
| 11 | Token 用量 Tooltip hover | 聊天区 → AI 消息时间戳旁 |
| 12 | 主题切换（暗色/亮色/跟随系统） | ThemeToggle 组件 |
| 13 | 对话删除二次点击确认 | 侧边栏 → 话题 → 垃圾桶图标 |
| 14 | 上下文轮数指示器 | 输入区右下角 |
| 15 | System Prompt 展示卡片 + 点击编辑 | 聊天区顶部 |

---

## 总结

- **1 个需要修复的 Bug**：模型验证缓存导致校验失效（1 行代码）
- **0 个回归问题**：之前修改的功能均工作正常
- **15 个 UI 交互项待浏览器验证**
- **修复后建议**：清理 `modelCache` 中 key 为 `undefined` 的脏缓存，或重启服务让缓存自然清空
