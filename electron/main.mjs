import * as electron from 'electron/main';
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage } = electron;
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { createPetWindow, updatePetWindow, sendPetEvent, loadConfig, saveConfig } from './pet-window.mjs';

// 记录崩溃日志到桌面的辅助函数（进程崩溃后日志不会丢失）
function crashLog(msg) {
  try {
    const desktop = path.join(os.homedir(), 'Desktop', 'aichat-crash.log');
    const ts = new Date().toISOString();
    fs.appendFileSync(desktop, `[${ts}] ${msg}\n`);
  } catch { /* 忽略写日志失败 */ }
}

process.on('uncaughtException', (err) => {
  crashLog(`未捕获异常: ${err.message}\n${err.stack}`);
  app.quit();
});

process.on('unhandledRejection', (reason) => {
  crashLog(`未处理的 Promise 拒绝: ${reason}`);
});
import { startFullscreenDetection, stopFullscreenDetection } from './fullscreen-detector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;
let petWindow = null;
let tray = null;
let serverChild = null;

// 创建 16x16 纯色托盘图标（无图标文件时的回退）
function createTrayIcon() {
  // 尝试从 build 目录加载图标
  const iconPath = path.join(__dirname, isDev ? '../build/icon.ico' : '../build/icon.ico');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  // 回退：生成一个简单的紫色方块
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = 0x55;     // R
    buf[i * 4 + 1] = 0x70; // G
    buf[i * 4 + 2] = 0xB8; // B
    buf[i * 4 + 3] = 0xFF; // A
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('AI Chat');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        stopFullscreenDetection();
        if (petWindow && !petWindow.isDestroyed()) petWindow.close();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
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

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      // 显示系统托盘提示
      if (tray) {
        tray.displayBalloon({
          title: 'AI Chat',
          content: '程序已最小化到系统托盘，双击托盘图标可重新打开',
        });
      }
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

function startServer() {
  let child;

  if (isDev) {
    child = spawn('npx', ['tsx', path.join(__dirname, '../server/src/index.ts')], {
      env: { ...process.env },
      stdio: 'pipe',
    });
    serverChild = child;
  } else {
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

  serverChild = child;

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
          // ignore
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
    serverChild = null;
  });
}

// 禁用 GPU 加速，避免无 GPU 环境下崩溃（WM/Server 环境常见问题）
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow) {
      const newState = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(newState);
      mainWindow.webContents.send('fullscreen-changed', newState);
    }
  });

  ipcMain.on('pet:activate', (_event, petData) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.close();
    }
    petWindow = createPetWindow(mainWindow);
    const config = loadConfig();
    config.defaultPetId = petData.id;
    saveConfig(config);
    petWindow.webContents.on('did-finish-load', () => {
      petWindow.webContents.send('pet:load', petData);
    });
    startFullscreenDetection(mainWindow, petWindow);
  });

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

  ipcMain.on('pet:update-config', (_event, config) => {
    updatePetWindow(petWindow, config);
  });

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

  ipcMain.handle('pet:list-installed', async () => {
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    if (!fs.existsSync(petsDir)) return [];
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
          name: manifest.displayName || manifest.id || manifest.name,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          installedAt: fs.statSync(manifestPath).mtime.toISOString(),
        });
      } catch { /* skip */ }
    }
    return pets.sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle('pet:import-local', async (_event, sourceDir) => {
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    if (!fs.existsSync(petsDir)) fs.mkdirSync(petsDir, { recursive: true });
    const manifestPath = path.join(sourceDir, 'pet.json');
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: '未找到 pet.json' };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const petName = manifest.id || manifest.name || path.basename(sourceDir);
    const destDir = path.join(petsDir, petName);
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

  ipcMain.on('pet:action', (_event, action) => {
    if (action.type === 'double-click') {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  createTray();
  startServer();
  setTimeout(createWindow, 2000);

  const config = loadConfig();
  if (config.autoWakeOnStartup && config.defaultPetId) {
    setTimeout(() => {
      try {
        petWindow = createPetWindow(mainWindow);
        if (petWindow) startFullscreenDetection(mainWindow, petWindow);
      } catch (err) {
        console.error('[Pet] 创建失败:', err.message);
      }
    }, 3000);
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverChild) {
    try { serverChild.kill(); } catch {}
  }
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  stopFullscreenDetection();
  if (process.platform !== 'darwin') app.quit();
  // 退出时清理托盘
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
