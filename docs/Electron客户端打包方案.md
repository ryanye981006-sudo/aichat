# Electron 客户端打包方案

## 架构概述

```
release/win-unpacked/
├── aichat.exe                 # Electron 主进程
├── resources/
│   ├── app.asar               # 前端 (dist/) + Electron 脚本 (electron/)
│   ├── node.exe               # 便携版 Node.js（运行后端）
│   ├── node_modules/          # 生产依赖（供后端 node.exe 加载）
│   └── server-dist/           # 编译后的后端代码
```

**核心设计**：前端（Vite 打包）和 Electron 主进程放在 `app.asar` 中；后端代码和依赖放在 `resources/` 文件系统上，由内嵌的便携版 `node.exe` 独立运行。这样后端绕开了 Electron 内嵌 Node.js 的 V8 ABI 兼容问题。

## 关键技术决策

### 1. 后端运行时：内嵌 Node.js 而非 ELECTRON_RUN_AS_NODE

**问题**：Electron 42 内嵌 Node.js v24.15.0，其 V8 头文件与 `better-sqlite3` 不兼容：

```
error C3861: '__builtin_frame_address': identifier not found
error C2668: 'v8::Template::SetNativeDataProperty': ambiguous call to overloaded function
error C2660: 'v8::External::Value': function does not take 0 arguments
```

`@electron/rebuild` 和 `npm rebuild` 均无法针对 Electron 42 的 V8 编译 `better-sqlite3`。

**方案**：内嵌系统 Node.js v22.13.1 的 `node.exe`（与编译 `better-sqlite3` 的 Node.js 版本一致），后端作为独立进程运行，使用标准文件系统加载依赖。

```js
// electron/main.mjs — startServer() 生产模式分支
const nodeExe = path.join(process.resourcesPath, 'node.exe');
const serverEntry = path.join(process.resourcesPath, 'server-dist', 'src', 'index.js');
child = spawn(nodeExe, [serverEntry], {
  env: { ...process.env },
  stdio: 'pipe',
});
```

### 2. node_modules 位置：extraResources 而非 asar

**问题**：标准 Node.js（`node.exe`）无法读取 `app.asar` 内的文件，`require()` 会失败。

**方案**：`node_modules` 和 `server-dist` 通过 `extraResources` 放到 `resources/` 文件系统上，Node.js 正常解析依赖链：

```
resources/server-dist/src/index.js
  → require('express')
    → 向上查找 node_modules
      → resources/server-dist/node_modules/  ✗
      → resources/node_modules/              ✓ (extraResources)
```

```yaml
# electron-builder.yml
files:
  # 只有前端和 Electron 脚本进 asar
  - dist/**/*
  - electron/**/*
  - package.json
  - "!electron/bin"    # node.exe 不进 asar

extraResources:
  - from: electron/bin/node.exe    → resources/node.exe
  - from: server-dist              → resources/server-dist
  - from: node_modules             → resources/node_modules
```

### 3. 构建流程：裁剪 → 打包 → 恢复

**问题**：`extraResources` 会原样复制 `node_modules`，包含大量 devDependencies（electron 本身 120MB+），导致包体积过大。

**方案**：打包前 `npm prune --production` 只保留生产依赖，打包后 `npm install` 恢复。

```js
// scripts/build-package.js
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const electronVersion = pkg.devDependencies?.electron?.replace(/^[\^~]/, '');

execSync('npm prune --production', { stdio: 'inherit' });
try {
  // prune 后 electron-builder 已不存在，用 npx 按需下载
  // 显式传入 electronVersion 因为本地 electron 包已被 prune
  execSync(`npx electron-builder@26.8.1 -c.electronVersion=${electronVersion}`, {
    stdio: 'inherit',
  });
} finally {
  execSync('npm install', { stdio: 'inherit' });
}
```

**注意**：`npm prune` 后 `electron` 包不存在，electron-builder 无法自动检测版本。需要：
1. `package.json` 中 electron 使用**精确版本**（`"42.0.1"` 而非 `"^42.0.1"`）
2. 通过 `-c.electronVersion=42.0.1` 显式传入

### 4. better-sqlite3 依赖链

`better-sqlite3` 在运行时需要以下依赖来加载 `.node` 原生二进制：

```
better-sqlite3 → bindings → file-uri-to-path
```

三者都在 `extraResources` 的 `node_modules` 中（文件系统上），无需特殊配置。`prebuild-install` 只是安装时使用，运行时不需要。

### 5. TypeScript 编译：非 .ts 文件需要额外复制

**问题**：`tsc` 只编译 `.ts` 文件，数据库迁移 SQL 文件不会被复制到 `server-dist`。

**解决**：`build:server` 脚本在 `tsc` 后手动复制：

```json
"build:server": "tsc -p tsconfig.server.json && node -e \"require('fs').cpSync('server/src/db/migrations','server-dist/src/db/migrations',{recursive:true})\""
```

## 配置清单

### package.json 关键字段

```json
{
  "type": "module",
  "main": "electron/main.mjs",
  "scripts": {
    "dev:electron": "concurrently -k \"vite --port=3000\" \"wait-on http://localhost:3000 && electron .\"",
    "build:server": "tsc -p tsconfig.server.json && node -e \"require('fs').cpSync('server/src/db/migrations','server-dist/src/db/migrations',{recursive:true})\"",
    "build": "npm run build:server && vite build && node scripts/build-package.js"
  },
  "dependencies": {
    "better-sqlite3": "12.10.0"
    // ... 其他生产依赖
  },
  "devDependencies": {
    "electron": "42.0.1",        // 精确版本，不能有 ^/~
    "electron-builder": "^26.8.1"
  }
}
```

### electron-builder.yml

```yaml
appId: com.aichat.desktop
productName: aichat
npmRebuild: false              # 禁用原生模块重编译（我们自己管理）
directories:
  output: release
  buildResources: build
files:
  - dist/**/*
  - electron/**/*
  - package.json
  - "!electron/bin"            # node.exe 不进 asar
  - "!node_modules"            # node_modules 不进 asar
  - "!server"                  # 源码不进包
  - "!*.ts"
extraResources:
  - from: electron/bin/node.exe
    to: node.exe
  - from: server-dist
    to: server-dist
  - from: node_modules
    to: node_modules
win:
  target:
    - target: zip
      arch: [x64]
  icon: build/icon.ico
```

### vite.config.ts

```ts
// 生产模式使用相对路径，适配 Electron file:// 协议
base: mode === 'production' ? './' : '/',
```

### API 基础 URL（双环境）

```ts
// src/services/api.ts
const isElectron = !!(
  typeof window !== 'undefined' &&
  (window as any).electronAPI?.isElectron
);
const BASE_URL = isElectron ? 'http://localhost:3001/api' : '/api';
```

## 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| `Cannot find module 'bindings'` | better-sqlite3 在 asar 中解包后找不到依赖 | 将 node_modules 整体放到 extraResources |
| `Could not locate the bindings file` | .node 二进制 ABI 版本不匹配 | 内嵌相同版本的 node.exe，npm rebuild 针对该版本编译 |
| `Cannot compute electron version` | prune 后 electron 包不存在 | package.json 用精确版本 + 显式传入 `-c.electronVersion` |
| `ENOENT: scandir .../migrations` | tsc 不复制 SQL/JSON 等非 .ts 文件 | build:server 增加 cp 命令 |
| 打包后 `添加供应商失败` | 后端未启动（模块解析失败） | 验证 resources/ 下 node.exe / server-dist / node_modules 齐全 |
| 包体积过大 | extraResources 包含了 devDependencies | 打包前 prune 生产依赖 |

## 构建产物

| 文件 | 说明 |
|---|---|
| `release/win-unpacked/` | 解包目录，可直接运行 `aichat.exe` 测试 |
| `release/aichat-1.0.0-win.zip` | 分发用的压缩包 |
| `release/aichat 1.0.0.exe` | 便携版安装包（旧架构，已废弃） |

## 版本依赖关系

```
系统 Node.js v22.13.1  (编译 better-sqlite3 + 复制 node.exe 进包)
Electron 42.0.1        (内嵌 Node.js v24.15.0，仅用于主进程)
better-sqlite3 12.10.0 (针对系统 Node.js 编译，由内嵌 node.exe 加载)
```
