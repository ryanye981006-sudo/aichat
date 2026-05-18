// 宠物悬浮窗管理模块 — 独立透明 BrowserWindow (CommonJS)
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

function getConfigPath() {
  const home = process.env.USERPROFILE || process.env.HOME || '~';
  return path.join(home, '.aichat', 'pet-config.json');
}

function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {
    defaultPetId: null,
    zoom: 1.0,
    position: 'bottom-right',
    customPosition: null,
    autoWakeOnStartup: true,
  };
}

function saveConfig(config) {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function calcPosition(petWindow, config, workArea) {
  const petSize = Math.round(192 * (config.zoom || 1.0));
  if (config.position === 'custom' && config.customPosition) {
    return { x: config.customPosition.x, y: config.customPosition.y };
  }
  const margin = 20;
  if (config.position === 'bottom-left') {
    return { x: workArea.x + margin, y: workArea.y + workArea.height - petSize - margin };
  }
  return { x: workArea.x + workArea.width - petSize - margin, y: workArea.y + workArea.height - petSize - margin };
}

function createPetWindow(mainWindow) {
  const config = loadConfig();
  const petSize = Math.round(192 * (config.zoom || 1.0));
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const pos = calcPosition(null, config, workArea);

  const petWindow = new BrowserWindow({
    width: petSize,
    height: Math.round(208 * (config.zoom || 1.0)),
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    type: 'toolbar',
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.setIgnoreMouseEvents(true, { forward: true });

  // 拖拽处理
  petWindow.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'pet:drag-start') {
      petWindow.setIgnoreMouseEvents(false);
    }
    if (channel === 'pet:drag-end') {
      const bounds = petWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(bounds);
      const wa = currentDisplay.workArea;
      const snapThreshold = 20;
      let newX = bounds.x;
      let newY = bounds.y;
      if (Math.abs(bounds.x - wa.x) <= snapThreshold) newX = wa.x;
      if (Math.abs(bounds.x + bounds.width - (wa.x + wa.width)) <= snapThreshold) newX = wa.x + wa.width - bounds.width;
      if (Math.abs(bounds.y - wa.y) <= snapThreshold) newY = wa.y;
      if (Math.abs(bounds.y + bounds.height - (wa.y + wa.height)) <= snapThreshold) newY = wa.y + wa.height - bounds.height;
      if (newX !== bounds.x || newY !== bounds.y) {
        petWindow.setBounds({ x: newX, y: newY, width: bounds.width, height: bounds.height });
      }
      const cfg = loadConfig();
      cfg.position = 'custom';
      cfg.customPosition = { x: newX, y: newY };
      saveConfig(cfg);
      petWindow.setIgnoreMouseEvents(true, { forward: true });
      petWindow.webContents.send('pet:enable-transparent');
    }
  });

  // 主窗口跨屏时宠物跟随
  let lastScreenId = null;
  const screenFollowInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const mainBounds = mainWindow.getBounds();
    const mainDisplay = screen.getDisplayMatching(mainBounds);
    if (lastScreenId && lastScreenId !== mainDisplay.id) {
      const petBounds = petWindow.getBounds();
      const oldDisplay = screen.getAllDisplays().find(d => d.id === lastScreenId);
      if (oldDisplay) {
        const xRatio = (petBounds.x - oldDisplay.workArea.x) / oldDisplay.workArea.width;
        const yRatio = (petBounds.y - oldDisplay.workArea.y) / oldDisplay.workArea.height;
        const newX = mainDisplay.workArea.x + Math.round(mainDisplay.workArea.width * xRatio);
        const newY = mainDisplay.workArea.y + Math.round(mainDisplay.workArea.height * yRatio);
        petWindow.setPosition(newX, newY);
      }
    }
    lastScreenId = mainDisplay.id;
  }, 1000);

  petWindow.on('closed', () => {
    clearInterval(screenFollowInterval);
  });

  return petWindow;
}

function updatePetWindow(petWindow, config) {
  if (!petWindow || petWindow.isDestroyed()) return;
  var bounds = petWindow.getBounds();
  var oldCenterX = bounds.x + bounds.width / 2;
  var oldCenterY = bounds.y + bounds.height / 2;
  var newW = Math.round(192 * (config.zoom || 1.0));
  var newH = Math.round(208 * (config.zoom || 1.0));
  if (config.position !== 'custom') {
    var display = screen.getDisplayMatching(bounds);
    var pos = calcPosition(petWindow, config, display.workArea);
    petWindow.setBounds({ x: pos.x, y: pos.y, width: newW, height: newH });
  } else {
    // 自定义位置：以中心点锚定缩放
    petWindow.setBounds({
      x: Math.round(oldCenterX - newW / 2),
      y: Math.round(oldCenterY - newH / 2),
      width: newW,
      height: newH,
    });
  }
  saveConfig(config);
  petWindow.webContents.send('pet:update-config', config);
}

function sendPetEvent(petWindow, event) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:event', event);
  }
}

function loadPetPosition() {
  const config = loadConfig();
  return config.customPosition || null;
}

function savePetPosition(pos) {
  const config = loadConfig();
  config.position = 'custom';
  config.customPosition = pos;
  saveConfig(config);
}

module.exports = {
  createPetWindow,
  updatePetWindow,
  sendPetEvent,
  loadPetPosition,
  savePetPosition,
  loadConfig,
  saveConfig,
};
