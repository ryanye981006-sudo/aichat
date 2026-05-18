// 下载便携版 Node.js Windows 二进制 — 供 electron-builder 打包用
// 用法: node scripts/download-node-portable.js
// 确保 app 能在没有系统 Node.js 的机器上启动后端服务

import https from 'https';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, '..', 'electron', 'bin');
const NODE_EXE = join(BIN_DIR, 'node.exe');

// 从当前系统 Node 版本号匹配下载
const nodeVersion = process.version; // e.g. v24.10.0
const arch = process.arch;           // e.g. x64
const platform = process.platform;   // e.g. win32

if (platform !== 'win32') {
  console.log('[download-node] 非 Windows 平台，跳过下载');
  process.exit(0);
}

if (existsSync(NODE_EXE)) {
  console.log(`[download-node] node.exe 已存在: ${NODE_EXE}`);
  process.exit(0);
}

const zipName = `node-${nodeVersion}-win-${arch}.zip`;
const url = `https://nodejs.org/dist/${nodeVersion}/${zipName}`;

console.log(`[download-node] 下载 ${url} ...`);

// 创建临时目录
if (!existsSync(BIN_DIR)) {
  mkdirSync(BIN_DIR, { recursive: true });
}

const zipPath = join(BIN_DIR, zipName);

// 下载 zip
await new Promise((resolve, reject) => {
  https.get(url, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      // 跟随重定向
      https.get(res.headers.location, (redirectRes) => {
        const file = createWriteStream(zipPath);
        redirectRes.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      });
      return;
    }
    if (res.statusCode !== 200) {
      reject(new Error(`下载失败: HTTP ${res.statusCode}`));
      return;
    }
    const file = createWriteStream(zipPath);
    res.pipe(file);
    file.on('finish', () => { file.close(); resolve(); });
    file.on('error', reject);
  }).on('error', reject);
});

console.log('[download-node] 下载完成，解压...');

// 用 PowerShell 解压（Windows 自带，无需依赖）
execSync(
  `powershell -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${BIN_DIR}'"`,
  { stdio: 'inherit' }
);

// node.exe 在解压后的子目录中，移动到 bin 根目录
const extractedDir = join(BIN_DIR, `node-${nodeVersion}-win-${arch}`);
const extractedNode = join(extractedDir, 'node.exe');
if (existsSync(extractedNode)) {
  // 直接用 powershell 移动
  execSync(`powershell -Command "Move-Item -Force -Path '${extractedNode}' -Destination '${NODE_EXE}'"`, { stdio: 'inherit' });
  // 清理解压目录 + zip
  execSync(`powershell -Command "Remove-Item -Recurse -Force '${extractedDir}'"`, { stdio: 'inherit' });
}

// 清理 zip
if (existsSync(zipPath)) {
  execSync(`powershell -Command "Remove-Item -Force '${zipPath}'"`, { stdio: 'inherit' });
}

if (existsSync(NODE_EXE)) {
  console.log(`[download-node] 完成: ${NODE_EXE}`);
} else {
  console.error('[download-node] 失败: node.exe 未正确解压');
  process.exit(1);
}
