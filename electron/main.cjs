const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { createPetWindow, updatePetWindow, sendPetEvent, loadConfig, saveConfig } = require('./pet-window.cjs');
const { startFullscreenDetection, stopFullscreenDetection } = require('./fullscreen-detector.cjs');

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
    child = spawn('npx', ['tsx', path.join(__dirname, '../server/src/index.ts')], {
      env: { ...process.env },
      stdio: 'pipe',
    });
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
    console.log('[Pet] 扫描宠物目录:', petsDir);
    if (!fs.existsSync(petsDir)) {
      console.log('[Pet] 目录不存在:', petsDir);
      return [];
    }
    const entries = fs.readdirSync(petsDir, { withFileTypes: true });
    console.log('[Pet] 目录条目:', entries.length);
    const pets = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(petsDir, entry.name, 'pet.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        console.log('[Pet] 发现宠物:', entry.name, manifest.displayName);
        pets.push({
          id: entry.name,
          name: manifest.displayName || manifest.name,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          installedAt: fs.statSync(manifestPath).mtime.toISOString(),
        });
      } catch (err) {
        console.log('[Pet] 跳过损坏宠物:', entry.name, err.message);
      }
    }
    console.log('[Pet] 返回宠物列表:', pets.length);
    return pets.sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle('pet:import-local', async (_event, sourceDir) => {
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    if (!fs.existsSync(petsDir)) {
      fs.mkdirSync(petsDir, { recursive: true });
    }
    const manifestPath = path.join(sourceDir, 'pet.json');
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: '未找到 pet.json' };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const petName = manifest.name || path.basename(sourceDir);
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

  startServer();
  setTimeout(createWindow, 2000);

  const config = loadConfig();
  if (config.autoWakeOnStartup && config.defaultPetId) {
    setTimeout(() => {
      try {
        console.log('[Pet] 自动唤醒宠物:', config.defaultPetId);
        petWindow = createPetWindow(mainWindow);
        if (petWindow) {
          console.log('[Pet] 宠物窗口已创建');
          startFullscreenDetection(mainWindow, petWindow);
        }
      } catch (err) {
        console.error('[Pet] 创建宠物窗口失败:', err.message);
      }
    }, 3000);
  } else {
    console.log('[Pet] 跳过自动唤醒 (autoWake=%s, defaultPetId=%s)', config.autoWakeOnStartup, config.defaultPetId);
  }
});

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
