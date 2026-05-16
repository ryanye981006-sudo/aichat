// 构建打包脚本：独立安装后端依赖 → 清理 → 打包
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs';
import path from 'path';

const log = (msg) => console.log(`[build] ${msg}`);

// 1. 安装后端生产依赖到 server/node_modules（不污染根 node_modules）
log('安装后端生产依赖...');
const serverDir = path.resolve('server');

// 确保 server/package.json 存在
if (!existsSync(path.join(serverDir, 'package.json'))) {
  console.error('[build] 未找到 server/package.json，请先创建');
  process.exit(1);
}

// 先清理旧的后端 node_modules（确保干净安装）
const serverNodeModules = path.join(serverDir, 'node_modules');
if (existsSync(serverNodeModules)) {
  rmSync(serverNodeModules, { recursive: true });
}

execSync('npm install --production', { cwd: serverDir, stdio: 'inherit' });
log('后端依赖安装完成');

// 2. 清理 node_modules 非运行时文件
log('清理 node_modules 中非运行时文件...');

function cleanNodeModules(dir) {
  const patterns = [/\.d\.ts$/, /\.map$/, /\.md$/, /^LICENSE/, /^CHANGELOG/];
  const dirsToRemove = ['test', 'tests', '__tests__', 'docs', 'examples', '.github'];

  function walk(current) {
    if (!existsSync(current)) return;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (dirsToRemove.includes(entry.name)) {
            try { rmSync(full, { recursive: true }); } catch {}
          } else {
            walk(full);
          }
        } else if (entry.isFile()) {
          if (patterns.some(p => p.test(entry.name))) {
            try { rmSync(full); } catch {}
          }
        }
      }
    } catch {}
  }

  walk(dir);
}

cleanNodeModules(serverNodeModules);
log('清理非运行时文件完成');

// 3. 修剪 emoji-picker-element-data 语言包（仅保留 en 和 zh）
log('修剪 emoji-picker-element-data 语言包...');
const emojiDataDir = path.join(serverNodeModules, 'emoji-picker-element-data');
if (existsSync(emojiDataDir)) {
  try {
    const entries = readdirSync(emojiDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'en' && entry.name !== 'zh') {
        const localeDir = path.join(emojiDataDir, entry.name);
        try { rmSync(localeDir, { recursive: true }); } catch {}
      }
    }
    log('emoji 语言包修剪完成');
  } catch {}
} else {
  log('emoji-picker-element-data 未安装（不在后端依赖中）');
}

// 4. 构建（使用时间戳输出目录，规避 Windows Defender 锁文件）
log('运行 electron-builder...');

// 从根 package.json 读取 electron 精确版本（Phase 1.5 已改为精确版）
const rootPkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const electronVersion = rootPkg.devDependencies?.electron?.replace(/^[\^~]/, '') || '42.0.1';

let buildSuccess = false;
const maxRetries = 3;
// 每次构建使用独立输出目录，规避 Windows Defender 锁定旧 exe
const buildId = Date.now().toString(36);
const finalOutDir = `release-${buildId}`;

try {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        log(`重试第 ${attempt} 次（等待 Defender 释放文件锁）...`);
      }
      const outDir = `${finalOutDir}-${attempt}`;
      execSync(
        `npx electron-builder@26.8.1 -c.electronVersion=${electronVersion} -c.directories.output=${outDir}`,
        { stdio: 'inherit' }
      );
      // 将最终成功的构建目录重命名为固定名 release
      if (outDir !== finalOutDir) {
        try { rmSync(finalOutDir, { recursive: true, force: true }); } catch {}
        try {
          renameSync(path.resolve(outDir), path.resolve(finalOutDir));
        } catch {
          // rename 失败（跨卷/权限），回退到 xcopy
          execSync(`xcopy /E /I /Y "${path.resolve(outDir)}" "${path.resolve(finalOutDir)}"`, { stdio: 'inherit' });
          try { rmSync(path.resolve(outDir), { recursive: true, force: true }); } catch {}
        }
      }
      // 清理其他临时构建目录
      for (const entry of readdirSync(path.resolve('.'))) {
        if (entry.startsWith('release-') && entry !== finalOutDir) {
          try { rmSync(path.resolve(entry), { recursive: true, force: true }); } catch {}
        }
      }
      buildSuccess = true;
      break;
    } catch (err) {
      if (attempt < maxRetries) {
        log(`构建失败，等待 5 秒后重试...`);
        execSync('sleep 5', { stdio: 'ignore' });
      } else {
        throw err;
      }
    }
  }
  if (buildSuccess) {
    log(`打包完成，输出目录: ${finalOutDir}`);
    log(`  - 解包版: ${finalOutDir}/win-unpacked/`);
    log(`  - 压缩包: ${finalOutDir}/aichat-1.0.0-win.zip`);
  }
} finally {
  // 5. 清理临时 server/node_modules
  if (existsSync(serverNodeModules)) {
    log('清理临时 server/node_modules...');
    try { rmSync(serverNodeModules, { recursive: true }); } catch {}
    log('清理完成');
  }
}
