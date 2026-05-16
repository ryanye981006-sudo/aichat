import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');

import { createPetWindow, updatePetWindow, sendPetEvent, loadConfig, saveConfig } from './pet-window.mjs';
import { startFullscreenDetection, stopFullscreenDetection } from './fullscreen-detector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;
let petWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    registerShortcuts();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 允许关闭到系统托盘（仅隐藏主窗口，宠物继续显示）
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function registerShortcuts() {
  globalShortcut.register('F11', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });
}

// 启动 Express 后端
function startServer() {
  let child;

  if (isDev) {
    // 开发模式：用 npx tsx 运行 TS 源码
    child = spawn('npx', ['tsx', path.join(__dirname, '../server/src/index.ts')], {
      env: { ...process.env },
      stdio: 'pipe',
    });
  } else {
    // 生产模式：用内嵌的便携 Node.js 运行编译后的 server-dist
    const nodeExe = path.join(process.resourcesPath, 'node.exe');
    const serverEntry = path.join(process.resourcesPath, 'server-dist', 'src', 'index.js');

    if (!fs.existsSync(nodeExe)) {
      console.error('[Server] 找不到内嵌 Node.js:', nodeExe);
      return;
    }
    if (!fs.existsSync(serverEntry)) {
      console.error('[Server] 找不到服务端入口:', serverEntry);
      return;
    }

    child = spawn(nodeExe, [serverEntry], {
      env: { ...process.env },
      stdio: 'pipe',
    });
  }

  // 解析 stdout 中的 JSON 事件（PET_EVENT: 前缀标记），其余照旧打印
  child.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('PET_EVENT:')) {
        try {
          const event = JSON.parse(line.slice('PET_EVENT:'.length));
          if (event.type && event.type.startsWith('session:')) {
            sendPetEvent(petWindow, event);
          }
        } catch {
          // 解析失败，忽略
        }
      } else {
        console.log(`[Server] ${line}`);
      }
    }
  });

  child.stderr?.on('data', (data) => {
    console.error(`[Server] ${data.toString().trim()}`);
  });
  child.on('exit', (code) => {
    console.log(`[Server] 进程退出，退出码: ${code}`);
  });
}

app.whenReady().then(() => {
  // IPC: 前端触发全屏切换
  ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow) {
      const newState = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(newState);
      mainWindow.webContents.send('fullscreen-changed', newState);
    }
  });

  // ---- 宠物管理 IPC ----

  // 激活宠物（创建设置悬浮窗）
  ipcMain.on('pet:activate', (_event, petData) => {
    // 如果已有宠物窗口，先关闭
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.close();
    }
    // 创建新宠物窗口
    petWindow = createPetWindow(mainWindow);

    // 保存默认宠物 ID
    const config = loadConfig();
    config.defaultPetId = petData.id;
    saveConfig(config);

    // 通知渲染进程加载这只宠物
    petWindow.webContents.on('did-finish-load', () => {
      petWindow.webContents.send('pet:load', petData);
    });

    // 启动全屏检测
    startFullscreenDetection(mainWindow, petWindow);
  });

  // 停用宠物
  ipcMain.on('pet:deactivate', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      stopFullscreenDetection();
      petWindow.close();
      petWindow = null;
    }
    const config = loadConfig();
    config.defaultPetId = null;
    saveConfig(config);
  });

  // 更新宠物配置（缩放/位置）
  ipcMain.on('pet:update-config', (_event, config) => {
    updatePetWindow(petWindow, config);
  });

  // 从 URL 导入宠物
  ipcMain.handle('pet:import-url', async (_event, url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return { success: false, error: `下载失败: HTTP ${response.status}` };
      }
      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 扫描已安装宠物列表
  ipcMain.handle('pet:list-installed', async () => {
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    if (!fs.existsSync(petsDir)) {
      return [];
    }
    const entries = fs.readdirSync(petsDir, { withFileTypes: true });
    const pets = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(petsDir, entry.name, 'pet.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        pets.push({
          id: entry.name,
          name: manifest.displayName || manifest.name,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          installedAt: fs.statSync(manifestPath).mtime.toISOString(),
        });
      } catch {
        // 跳过损坏的
      }
    }
    return pets.sort((a, b) => a.name.localeCompare(b.name));
  });

  // 从本地文件导入宠物
  ipcMain.handle('pet:import-local', async (_event, sourceDir) => {
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    if (!fs.existsSync(petsDir)) {
      fs.mkdirSync(petsDir, { recursive: true });
    }
    // 读取源目录的 pet.json 获取宠物名
    const manifestPath = path.join(sourceDir, 'pet.json');
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: '未找到 pet.json' };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const petName = manifest.name || path.basename(sourceDir);
    const destDir = path.join(petsDir, petName);
    // 复制整个目录
    fs.cpSync(sourceDir, destDir, { recursive: true });
    return {
      success: true,
      pet: {
        id: petName,
        name: manifest.displayName || manifest.name,
        description: manifest.description || '',
        version: manifest.version || '1.0.0',
        installedAt: new Date().toISOString(),
      },
    };
  });

  // ---- 宠物交互 IPC（宠物窗口 → 主进程） ----
  ipcMain.on('pet:action', (_event, action) => {
    if (action.type === 'double-click') {
      // 双击宠物 → 呼出主窗口
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  startServer();
  // 给服务端一点启动时间
  setTimeout(createWindow, 2000);

  // 启动时自动唤醒宠物
  const config = loadConfig();
  if (config.autoWakeOnStartup && config.defaultPetId) {
    setTimeout(() => {
      petWindow = createPetWindow(mainWindow);
      if (petWindow) {
        startFullscreenDetection(mainWindow, petWindow);
      }
    }, 3000);
  }
});

// 确保彻底退出时清理
app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  stopFullscreenDetection();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
