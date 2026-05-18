import * as electron from 'electron/main';
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage } = electron;
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { createPetWindow, updatePetWindow, sendPetEvent, loadConfig, saveConfig } from './pet-window.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const logger = require('./logger.cjs');

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
      logger.error('Main', `找不到内嵌 Node.js: ${nodeExe}`);
      console.error('[Server] 找不到内嵌 Node.js:', nodeExe);
      return;
    }
    if (!fs.existsSync(serverEntry)) {
      logger.error('Main', `找不到服务端入口: ${serverEntry}`);
      console.error('[Server] 找不到服务端入口:', serverEntry);
      return;
    }

    child = spawn(nodeExe, [serverEntry], {
      env: { ...process.env },
      stdio: 'pipe',
    });
  }

  serverChild = child;
  logger.info('Main', `后端进程已启动, PID=${child.pid}`);

  child.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('PET_EVENT:')) {
        try {
          const event = JSON.parse(line.slice('PET_EVENT:'.length));
          if (event.type && event.type.startsWith('session:')) {
            logger.debug('Main', `收到 PET_EVENT: ${event.type}`);
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

  // 加载宠物完整数据（解析路径 + manifest，社区缺失字段填充 Codex 默认值）
  function loadPetData(petId) {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir?.() || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    const petPath = path.join(petsDir, petId);
    const manifestPath = path.join(petPath, 'pet.json');

    logger.info('Main', `loadPetData: petId="${petId}", petsDir="${petsDir}"`);

    if (!fs.existsSync(manifestPath)) {
      logger.error('Main', `找不到 pet.json: ${manifestPath}`);
      throw new Error(`找不到宠物: ${manifestPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    logger.info('Main', `pet.json 已加载: displayName="${raw.displayName}", id="${raw.id}", name="${raw.name}"`);
    logger.debug('Main', `pet.json sprite=${JSON.stringify(raw.sprite)}, spritesheetPath="${raw.spritesheetPath}"`);
    logger.debug('Main', `pet.json animations keys=${raw.animations ? Object.keys(raw.animations).join(',') : '(无)'}`);

    if (!raw.sprite) {
      logger.info('Main', 'pet.json 缺少 sprite，填充 Codex 默认值');
      raw.sprite = { url: 'spritesheet.webp', width: 192, height: 208, columns: 8, rows: 9 };
      if (raw.spritesheetPath) raw.sprite.url = raw.spritesheetPath;
    }
    if (!raw.animations || Object.keys(raw.animations).length === 0) {
      logger.info('Main', 'pet.json 缺少 animations，填充 Codex 默认值');
      raw.animations = {
        idle:         { row: 0, frames: 6, fps: 6 },
        waving:       { row: 1, frames: 4, fps: 6 },
        review:       { row: 2, frames: 6, fps: 6 },
        runningRight: { row: 3, frames: 8, fps: 8 },
        jumping:      { row: 4, frames: 5, fps: 7 },
        grab:         { row: 5, frames: 8, fps: 7 },
        failed:       { row: 6, frames: 8, fps: 7 },
        grabbing:     { row: 7, frames: 6, fps: 6 },
        runningLeft:  { row: 8, frames: 8, fps: 8 },
      };
    }

    // 验证 spritesheet 文件是否存在
    const ssPath = path.join(petPath, raw.sprite.url);
    if (!fs.existsSync(ssPath)) {
      logger.error('Main', `spritesheet 文件不存在: ${ssPath}`);
    } else {
      logger.info('Main', `spritesheet 已确认存在: ${ssPath} (${fs.statSync(ssPath).size} bytes)`);
    }

    return { id: petId, path: petPath, manifest: raw };
  }

  ipcMain.on('pet:activate', (_event, petData) => {
    logger.info('Main', `pet:activate 收到请求: ${JSON.stringify(petData)}`);
    if (petWindow && !petWindow.isDestroyed()) {
      logger.info('Main', '关闭旧的宠物窗口');
      petWindow.close();
    }
    petWindow = createPetWindow(mainWindow);
    logger.info('Main', `宠物窗口已创建, id=${petWindow.id}`);
    const config = loadConfig();
    config.defaultPetId = petData.id;
    saveConfig(config);
    const fullData = loadPetData(petData.id);
    fullData.zoom = petData.zoom || 1.0;
    petWindow.webContents.on('did-finish-load', () => {
      logger.info('Main', 'pet.html 加载完成, 发送 pet:load 数据');
      petWindow.webContents.send('pet:load', fullData);
    });
    startFullscreenDetection(mainWindow, petWindow);
  });

  ipcMain.on('pet:deactivate', () => {
    logger.info('Main', 'pet:deactivate 收到请求');
    if (petWindow && !petWindow.isDestroyed()) {
      logger.info('Main', '关闭宠物窗口');
      stopFullscreenDetection();
      petWindow.close();
      petWindow = null;
    }
    const config = loadConfig();
    config.defaultPetId = null;
    saveConfig(config);
  });

  ipcMain.on('pet:update-config', (_event, config) => {
    logger.debug('Main', `pet:update-config: ${JSON.stringify(config)}`);
    updatePetWindow(petWindow, config);
  });

  ipcMain.handle('pet:import-url', async (_event, url) => {
    logger.info('Main', `pet:import-url: ${url}`);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        logger.error('Main', `pet:import-url 下载失败: HTTP ${response.status}`);
        return { success: false, error: `下载失败: HTTP ${response.status}` };
      }
      const data = await response.json();
      logger.info('Main', `pet:import-url 成功, data keys: ${Object.keys(data).join(',')}`);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('pet:list-installed', async () => {
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    logger.info('Main', `pet:list-installed: 扫描目录 "${petsDir}"`);
    if (!fs.existsSync(petsDir)) {
      logger.warn('Main', `宠物目录不存在: "${petsDir}"`);
      return [];
    }
    const entries = fs.readdirSync(petsDir, { withFileTypes: true });
    logger.info('Main', `目录条目数: ${entries.length}`);
    const pets = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(petsDir, entry.name, 'pet.json');
      if (!fs.existsSync(manifestPath)) {
        logger.warn('Main', `跳过目录 "${entry.name}": 无 pet.json`);
        continue;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const pet = {
          id: entry.name,
          name: manifest.displayName || manifest.id || manifest.name,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          installedAt: fs.statSync(manifestPath).mtime.toISOString(),
          spritesheetUrl: `http://localhost:3001/api/pets/${entry.name}/spritesheet`,
        };
        pets.push(pet);
        logger.info('Main', `发现宠物: id="${pet.id}", name="${pet.name}"`);
      } catch (err) {
        logger.error('Main', `跳过损坏宠物 "${entry.name}": ${err.message}`);
      }
    }
    logger.info('Main', `pet:list-installed 返回 ${pets.length} 个宠物`);
    return pets.sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle('pet:import-local', async (_event, sourceDir) => {
    logger.info('Main', `pet:import-local: ${sourceDir}`);
    const home = process.env.USERPROFILE || process.env.HOME || '~';
    const petsDir = path.join(home, '.aichat', 'pets');
    if (!fs.existsSync(petsDir)) fs.mkdirSync(petsDir, { recursive: true });
    const manifestPath = path.join(sourceDir, 'pet.json');
    if (!fs.existsSync(manifestPath)) {
      logger.error('Main', `pet:import-local: 未找到 pet.json 在 ${sourceDir}`);
      return { success: false, error: '未找到 pet.json' };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const petName = manifest.id || manifest.name || path.basename(sourceDir);
    const destDir = path.join(petsDir, petName);
    logger.info('Main', `pet:import-local: 复制到 ${destDir}`);
    fs.cpSync(sourceDir, destDir, { recursive: true });
    return {
      success: true,
      pet: {
        id: petName,
        name: manifest.displayName || manifest.id || manifest.name,
        description: manifest.description || '',
        version: manifest.version || '1.0.0',
        installedAt: new Date().toISOString(),
      },
    };
  });

  ipcMain.on('pet:action', (_event, action) => {
    logger.debug('Main', `pet:action: ${action.type}`);
    if (action.type === 'double-click') {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
    if (action.type === 'drag-move') {
      if (petWindow && !petWindow.isDestroyed()) {
        const [x, y] = petWindow.getPosition();
        petWindow.setPosition(x + (action.dx || 0), y + (action.dy || 0));
      }
    }
  });

  // 拖拽开始：允许窗口接收鼠标事件
  ipcMain.on('pet:drag-start', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(false);
    }
  });

  // 拖拽结束：保存位置并恢复点击穿透
  ipcMain.on('pet:drag-end', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      const bounds = petWindow.getBounds();
      const cfg = loadConfig();
      cfg.position = 'custom';
      cfg.customPosition = { x: bounds.x, y: bounds.y };
      saveConfig(cfg);
      petWindow.setIgnoreMouseEvents(true, { forward: true });
      petWindow.webContents.send('pet:enable-transparent');
    }
  });

  // 日志查询（前端调试用）
  ipcMain.handle('pet:tail-log', async (_event, lines = 50) => {
    return logger.tail(lines);
  });

  // 首启：将预置社区桌宠安装到 ~/.aichat/pets/
  function installPresetPets() {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir?.() || '~';
    const petsDir = path.join(home, '.aichat', 'pets');

    // 生产模式：从 resources/preset-pets/ 读取；开发模式：从项目 assets/pets/ 读取
    const presetDir = app.isPackaged
      ? path.join(process.resourcesPath, 'preset-pets')
      : path.join(__dirname, '..', 'assets', 'pets');

    logger.info('Main', `installPresetPets: presetDir="${presetDir}", petsDir="${petsDir}"`);

    if (!fs.existsSync(presetDir)) {
      logger.warn('Main', `预置宠物目录不存在: "${presetDir}"`);
      return;
    }

    if (!fs.existsSync(petsDir)) {
      fs.mkdirSync(petsDir, { recursive: true });
    }

    const presetEntries = fs.readdirSync(presetDir, { withFileTypes: true });
    let installedCount = 0;
    for (const entry of presetEntries) {
      if (!entry.isDirectory()) continue;
      const destDir = path.join(petsDir, entry.name);
      if (fs.existsSync(destDir)) {
        logger.debug('Main', `跳过预置宠物 "${entry.name}": 已存在`);
        continue;
      }
      try {
        fs.cpSync(path.join(presetDir, entry.name), destDir, { recursive: true });
        logger.info('Main', `预置宠物已安装: "${entry.name}"`);
        installedCount++;
      } catch (err) {
        logger.error('Main', `安装预置宠物 "${entry.name}" 失败: ${err.message}`);
      }
    }
    logger.info('Main', `预置宠物安装完成，新安装 ${installedCount} 个`);
  }

  installPresetPets();

  createTray();
  startServer();
  setTimeout(createWindow, 2000);

  const config = loadConfig();
  logger.info('Main', `启动配置: autoWake=${config.autoWakeOnStartup}, defaultPetId="${config.defaultPetId}"`);
  if (config.autoWakeOnStartup && config.defaultPetId) {
    setTimeout(() => {
      try {
        logger.info('Main', `自动唤醒宠物: "${config.defaultPetId}"`);
        const fullData = loadPetData(config.defaultPetId);
        petWindow = createPetWindow(mainWindow);
        if (petWindow) {
          petWindow.webContents.on('did-finish-load', () => {
            logger.info('Main', '自动唤醒: pet.html 加载完成, 发送 pet:load');
            petWindow.webContents.send('pet:load', fullData);
          });
          startFullscreenDetection(mainWindow, petWindow);
        }
      } catch (err) {
        logger.error('Main', `自动唤醒失败: ${err.message}`);
        console.error('[Pet] 自动唤醒失败:', err.message);
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
