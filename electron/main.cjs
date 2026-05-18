const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { startFullscreenDetection, stopFullscreenDetection } = require('./fullscreen-detector.cjs');
const logger = require('./logger.cjs');

const isDev = !app.isPackaged;

let mainWindow = null;
let petOverlay = null;

// ---- 宠物配置 ----
const PET_CONFIG_PATH = path.join((process.env.USERPROFILE || process.env.HOME || os.homedir?.() || '~'), '.aichat', 'pet-config.json');

function loadPetConfig() {
  try {
    if (fs.existsSync(PET_CONFIG_PATH)) return JSON.parse(fs.readFileSync(PET_CONFIG_PATH, 'utf-8'));
  } catch (e) { /* ignore */ }
  return { defaultPetId: null, zoom: 1.0, position: 'bottom-right', customPosition: null, autoWakeOnStartup: true };
}
function savePetConfig(cfg) {
  var dir = path.dirname(PET_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PET_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ---- 全屏宠物覆盖层 ----
function createPetOverlay() {
  if (petOverlay && !petOverlay.isDestroyed()) {
    petOverlay.close();
  }
  var primaryDisplay = screen.getPrimaryDisplay();
  var w = primaryDisplay.workAreaSize.width;
  var h = primaryDisplay.workAreaSize.height;
  var x = primaryDisplay.workArea.x;
  var y = primaryDisplay.workArea.y;

  petOverlay = new BrowserWindow({
    x: x, y: y, width: w, height: h,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  petOverlay.loadFile(path.join(__dirname, 'pet.html'));
  petOverlay.setIgnoreMouseEvents(true, { forward: true });

  logger.info('Main', '全屏宠物覆盖层已创建: ' + w + 'x' + h + '+' + x + '+' + y);
  return petOverlay;
}

// ---- 主窗口 ----
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

  mainWindow.on('ready-to-show', function () { registerShortcuts(); });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', function () { mainWindow = null; });

  mainWindow.on('close', function (event) {
    if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });
}

function registerShortcuts() {
  globalShortcut.register('F11', function () {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
}

// ---- 后端服务 ----
function startServer() {
  var child;

  if (isDev) {
    child = spawn('npx', ['tsx', path.join(__dirname, '../server/src/index.ts')], {
      env: Object.assign({}, process.env), stdio: 'pipe',
    });
  } else {
    var nodeExe = path.join(process.resourcesPath, 'node.exe');
    var serverEntry = path.join(process.resourcesPath, 'server-dist', 'src', 'index.js');

    if (!fs.existsSync(nodeExe)) {
      logger.error('Main', '找不到内嵌 Node.js: ' + nodeExe);
      console.error('[Server] 找不到内嵌 Node.js:', nodeExe);
      return;
    }
    if (!fs.existsSync(serverEntry)) {
      logger.error('Main', '找不到服务端入口: ' + serverEntry);
      console.error('[Server] 找不到服务端入口:', serverEntry);
      return;
    }

    child = spawn(nodeExe, [serverEntry], {
      env: Object.assign({}, process.env), stdio: 'pipe',
    });
  }

  logger.info('Main', '后端进程已启动, PID=' + child.pid);

  child.stdout.on('data', function (data) {
    var lines = data.toString().trim().split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('PET_EVENT:') === 0) {
        try {
          var event = JSON.parse(line.slice('PET_EVENT:'.length));
          if (event.type && event.type.indexOf('session:') === 0) {
            if (petOverlay && !petOverlay.isDestroyed()) {
              petOverlay.webContents.send('pet:event', event);
            }
          }
        } catch (e) { /* ignore */ }
      } else {
        console.log('[Server] ' + line);
      }
    }
  });

  child.stderr.on('data', function (data) {
    console.error('[Server] ' + data.toString().trim());
  });
  child.on('exit', function (code) {
    logger.warn('Main', '后端进程退出, 退出码=' + code);
    console.log('[Server] 进程退出，退出码:', code);
  });
}

app.whenReady().then(function () {
  // 窗口控制 IPC
  ipcMain.on('window-minimize', function () { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window-maximize', function () {
    if (mainWindow) { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); }
  });
  ipcMain.on('window-close', function () { if (mainWindow) mainWindow.close(); });

  ipcMain.on('toggle-fullscreen', function () {
    if (mainWindow) {
      var newState = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(newState);
      mainWindow.webContents.send('fullscreen-changed', newState);
    }
  });

  // 加载宠物完整数据
  function loadPetData(petId) {
    var home = process.env.USERPROFILE || process.env.HOME || os.homedir?.() || '~';
    var petsDir = path.join(home, '.aichat', 'pets');
    var petPath = path.join(petsDir, petId);
    var manifestPath = path.join(petPath, 'pet.json');

    logger.info('Main', 'loadPetData: petId="' + petId + '", petsDir="' + petsDir + '"');

    if (!fs.existsSync(manifestPath)) {
      logger.error('Main', '找不到 pet.json: ' + manifestPath);
      throw new Error('找不到宠物: ' + manifestPath);
    }
    var raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    logger.info('Main', 'pet.json 已加载: displayName="' + raw.displayName + '", id="' + raw.id + '"');

    if (!raw.sprite) {
      raw.sprite = { url: 'spritesheet.webp', width: 192, height: 208, columns: 8, rows: 9 };
      if (raw.spritesheetPath) raw.sprite.url = raw.spritesheetPath;
    }
    if (!raw.animations || Object.keys(raw.animations).length === 0) {
      raw.animations = {
        idle: { row: 0, frames: 6, fps: 6 }, waving: { row: 1, frames: 4, fps: 6 },
        review: { row: 2, frames: 6, fps: 6 }, runningRight: { row: 3, frames: 8, fps: 8 },
        jumping: { row: 4, frames: 5, fps: 7 }, grab: { row: 5, frames: 8, fps: 7 },
        failed: { row: 6, frames: 8, fps: 7 }, grabbing: { row: 7, frames: 6, fps: 6 },
        runningLeft: { row: 8, frames: 8, fps: 8 },
      };
    }

    // Base64 data URL
    var ssPath = path.join(petPath, raw.sprite.url);
    var spritesheetDataUrl = null;
    if (!fs.existsSync(ssPath)) {
      logger.error('Main', 'spritesheet 文件不存在: ' + ssPath);
    } else {
      logger.info('Main', 'spritesheet 已确认存在: ' + ssPath + ' (' + fs.statSync(ssPath).size + ' bytes)');
      var ssBuffer = fs.readFileSync(ssPath);
      var ext = path.extname(ssPath).toLowerCase();
      var mime = ext === '.png' ? 'image/png' : 'image/webp';
      spritesheetDataUrl = 'data:' + mime + ';base64,' + ssBuffer.toString('base64');
    }

    return { id: petId, path: petPath, manifest: raw, spritesheetUrl: 'http://localhost:3001/api/pets/' + petId + '/spritesheet', spritesheetDataUrl: spritesheetDataUrl };
  }

  // 宠物 IPC
  ipcMain.on('pet:activate', function (_event, petData) {
    logger.info('Main', 'pet:activate: ' + JSON.stringify(petData));
    var overlay = createPetOverlay();
    var config = loadPetConfig();
    config.defaultPetId = petData.id;
    savePetConfig(config);
    var fullData = loadPetData(petData.id);
    fullData.zoom = petData.zoom || 1.0;
    fullData.config = config;
    overlay.webContents.on('did-finish-load', function () {
      logger.info('Main', 'pet.html 加载完成, 发送 pet:load');
      overlay.webContents.send('pet:load', fullData);
    });
    startFullscreenDetection(mainWindow, overlay);
  });

  ipcMain.on('pet:deactivate', function () {
    logger.info('Main', 'pet:deactivate');
    if (petOverlay && !petOverlay.isDestroyed()) {
      stopFullscreenDetection();
      petOverlay.close();
      petOverlay = null;
    }
    var config = loadPetConfig();
    config.defaultPetId = null;
    savePetConfig(config);
  });

  ipcMain.on('pet:update-config', function (_event, config) {
    logger.debug('Main', 'pet:update-config: ' + JSON.stringify(config));
    if (petOverlay && !petOverlay.isDestroyed()) {
      petOverlay.webContents.send('pet:update-config', config);
    }
    savePetConfig(config);
  });

  ipcMain.handle('pet:import-url', async function (_event, url) {
    logger.info('Main', 'pet:import-url: ' + url);
    try {
      var response = await fetch(url);
      if (!response.ok) return { success: false, error: '下载失败: HTTP ' + response.status };
      var data = await response.json();
      return { success: true, data: data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('pet:list-installed', async function () {
    var home = process.env.USERPROFILE || process.env.HOME || '~';
    var petsDir = path.join(home, '.aichat', 'pets');
    logger.info('Main', 'pet:list-installed: 扫描 "' + petsDir + '"');
    if (!fs.existsSync(petsDir)) { logger.warn('Main', '宠物目录不存在'); return []; }
    var entries = fs.readdirSync(petsDir, { withFileTypes: true });
    var pets = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.isDirectory()) continue;
      var manifestPath = path.join(petsDir, entry.name, 'pet.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        pets.push({
          id: entry.name,
          name: manifest.displayName || manifest.id || manifest.name,
          description: manifest.description || '',
          version: manifest.version || '1.0.0',
          installedAt: fs.statSync(manifestPath).mtime.toISOString(),
          spritesheetUrl: 'http://localhost:3001/api/pets/' + entry.name + '/spritesheet',
        });
        logger.info('Main', '发现宠物: id="' + entry.name + '", name="' + (manifest.displayName || manifest.id) + '"');
      } catch (e) { logger.error('Main', '跳过损坏宠物: ' + entry.name); }
    }
    return pets.sort(function (a, b) { return a.name.localeCompare(b.name); });
  });

  ipcMain.handle('pet:import-local', async function (_event, sourceDir) {
    logger.info('Main', 'pet:import-local: ' + sourceDir);
    var home = process.env.USERPROFILE || process.env.HOME || '~';
    var petsDir = path.join(home, '.aichat', 'pets');
    if (!fs.existsSync(petsDir)) fs.mkdirSync(petsDir, { recursive: true });
    var manifestPath = path.join(sourceDir, 'pet.json');
    if (!fs.existsSync(manifestPath)) return { success: false, error: '未找到 pet.json' };
    var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    var petName = manifest.id || manifest.name || path.basename(sourceDir);
    var destDir = path.join(petsDir, petName);
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

  ipcMain.on('pet:action', function (_event, action) {
    logger.debug('Main', 'pet:action: ' + action.type);
    if (action.type === 'double-click') {
      if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
    }
    if (action.type === 'drag-end') {
      if (action.x != null && action.y != null) {
        var cfg = loadPetConfig();
        cfg.position = 'custom';
        cfg.customPosition = { x: action.x, y: action.y };
        savePetConfig(cfg);
      }
    }
  });

  ipcMain.on('pet:drag-start', function () {
    if (petOverlay && !petOverlay.isDestroyed()) petOverlay.setIgnoreMouseEvents(false);
  });

  ipcMain.on('pet:drag-end', function () {
    if (petOverlay && !petOverlay.isDestroyed()) petOverlay.setIgnoreMouseEvents(true, { forward: true });
  });

  ipcMain.handle('pet:tail-log', async function (_event, lines) {
    return logger.tail(lines || 50);
  });

  // 预置宠物安装
  function installPresetPets() {
    var home = process.env.USERPROFILE || process.env.HOME || '~';
    var petsDir = path.join(home, '.aichat', 'pets');
    var presetDir = app.isPackaged
      ? path.join(process.resourcesPath, 'preset-pets')
      : path.join(__dirname, '..', 'assets', 'pets');

    if (!fs.existsSync(presetDir)) { logger.warn('Main', '预置宠物目录不存在'); return; }
    if (!fs.existsSync(petsDir)) fs.mkdirSync(petsDir, { recursive: true });

    var presetEntries = fs.readdirSync(presetDir, { withFileTypes: true });
    var installedCount = 0;
    for (var i = 0; i < presetEntries.length; i++) {
      var entry = presetEntries[i];
      if (!entry.isDirectory()) continue;
      var destDir = path.join(petsDir, entry.name);
      if (fs.existsSync(destDir)) continue;
      try {
        fs.cpSync(path.join(presetDir, entry.name), destDir, { recursive: true });
        installedCount++;
      } catch (e) {}
    }
    logger.info('Main', '预置宠物安装完成，新安装 ' + installedCount + ' 个');
  }

  installPresetPets();

  startServer();
  setTimeout(createWindow, 2000);

  var config = loadPetConfig();
  logger.info('Main', '启动配置: autoWake=' + config.autoWakeOnStartup + ', defaultPetId="' + (config.defaultPetId || '') + '"');
  if (config.autoWakeOnStartup && config.defaultPetId) {
    setTimeout(function () {
      try {
        var fullData = loadPetData(config.defaultPetId);
        fullData.zoom = config.zoom || 1.0;
        fullData.config = config;
        var overlay = createPetOverlay();
        overlay.webContents.on('did-finish-load', function () {
          overlay.webContents.send('pet:load', fullData);
        });
        startFullscreenDetection(mainWindow, overlay);
      } catch (err) {
        logger.error('Main', '自动唤醒失败: ' + err.message);
      }
    }, 3000);
  }
});

app.on('before-quit', function () { app.isQuitting = true; });

app.on('window-all-closed', function () {
  globalShortcut.unregisterAll();
  stopFullscreenDetection();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow(); else mainWindow.show();
});
