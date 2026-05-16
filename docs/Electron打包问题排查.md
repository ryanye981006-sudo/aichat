# Electron 打包问题排查

> `aichat.exe` 启动即崩溃，桌面窗口无法弹出。本文档记录问题现象、排查过程和结论。

---

## 一、问题现象

1. `npm run build` 构建成功，`release/win-unpacked/aichat.exe` 正常生成（226MB）
2. 双击 `aichat.exe` 无任何窗口弹出，进程立即退出
3. 命令行直接运行同样秒退，无任何错误输出到 stdout/stderr

---

## 二、排查过程

### 2.1 缩小范围：独立测试 Electron 模块加载

在 `/tmp` 创建最小 Electron 应用，排除业务代码干扰：

**测试 1：ESM import**
```js
// main.mjs + "type": "module" + package.json
import { app } from 'electron';
```
→ `SyntaxError: The requested module 'electron' does not provide an export named 'app'`

**测试 2：ESM default import**
```js
import electron from 'electron';
const { app } = electron;
```
→ `app` 为 `undefined`，`electron` 对象无任何可枚举属性

**测试 3：CJS require（无 "type": "module"）**
```js
const { app } = require('electron');
```
→ `MODULE_NOT_FOUND: Cannot find module 'electron'`

**测试 4：`import * from 'electron/main'`（Electron 默认 app 的写法）**
```js
import * as electron from 'electron/main';
const { app } = electron;
```
→ `electron` namespace 只有 `default` 和 `module.exports` 两个 key，`app` 为 `undefined`

**测试 5：`createRequire` 桥接**
```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { app } = require('electron');
```
→ 同样 `MODULE_NOT_FOUND`

### 2.2 确认 Electron 版本

```
$ electron.exe --version
v24.15.0   ← 这是内嵌 Node.js 版本

$ cat node_modules/electron/dist/version
42.0.1     ← 这是 Electron 版本

$ process.versions.electron
42.0.1     ← 运行时确认
$ process.type
undefined  ← 应为 'browser'，异常
```

**关键发现**：`process.type` 为 `undefined` 而非 `'browser'`，说明 Electron 主进程未正确初始化。

### 2.3 排查 npm 包劫持

`require('electron')` 解析到 `node_modules/electron/index.js`：

```js
// node_modules/electron/index.js
module.exports = getElectronPath();
// 返回: 'D:\\project\\aichat\\node_modules\\electron\\dist\\electron.exe'
```

→ 该文件导出的**不是** `{ app, BrowserWindow }` API 对象，而是 `electron.exe` 的**文件路径字符串**。

npm `electron` 包只是一个下载器/启动器，真正的 Electron API 应该由 Electron 二进制**内置模块**提供。但内置模块未注册。

### 2.4 排查 `"exports"` 字段

`node_modules/electron/package.json` 有 `"exports": {}`，可能阻止子路径导入。删除后重试，结果不变——不是这个原因。

### 2.5 排查 `"type": "module"` 影响

项目全局设了 `"type": "module"`，怀疑影响模块解析。创建无此字段的独立测试——`require('electron')` 仍然 `MODULE_NOT_FOUND`。

### 2.6 排查 Electron 版本

升级到 `electron@42.1.0`，问题依旧。

### 2.7 交叉验证：ClaudeRelay 项目

ClaudeRelay 使用 Electron 25.9.8 + CJS + `require('electron')`，其打包版 `ClaudeRelay.exe` **同样秒退**。

→ **排除了 Electron 版本问题、ESM/CJS 问题、代码问题。问题指向 Windows 系统环境。**

---

## 三、结论

| 结论 | 说明 |
|------|------|
| **不是代码问题** | 最小化 Electron 应用也无法启动 |
| **不是 Electron 版本问题** | v25 和 v42 均无法启动 |
| **不是 `"type": "module"` 问题** | 无此字段的独立测试同样失败 |
| **不是 electron-builder 问题** | 直接运行 `electron.exe` 也无法加载 |
| **高度怀疑是 Windows 环境限制** | 安全策略/沙箱/组策略阻止了 Electron 进程初始化 |

### 建议后续验证

1. 将 `release/win-unpacked/` 复制到另一台 Windows 机器测试
2. 检查 Windows 事件查看器中是否有相关错误日志
3. 检查是否有杀毒软件/安全策略拦截
4. 尝试用管理员权限运行

---

## 四、Electron 42 正确的 import 方式（供参考）

查看 Electron 42 自带的 `default_app.asar/main.js`，其导入方式为：

```js
import * as electron from 'electron/main';
const { app, dialog } = electron;
```

代码已按此方式更新（`electron/main.mjs`、`pet-window.mjs`、`fullscreen-detector.mjs`）。
