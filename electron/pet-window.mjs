// 宠物悬浮窗管理模块 — 独立透明 BrowserWindow
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { BrowserWindow, screen } = require('electron');

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// 获取 pet-config.json 路径
function getConfigPath() {
  const home = process.env.USERPROFILE || process.env.HOME || '~';
  return path.join(home, '.aichat', 'pet-config.json');
}

// 读取配置
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

// 保存配置
function saveConfig(config) {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// 根据配置计算宠物窗口位置
function calcPosition(petWindow, config, workArea) {
  const petSize = Math.round(192 * (config.zoom || 1.0));

  if (config.position === 'custom' && config.customPosition) {
    return { x: config.customPosition.x, y: config.customPosition.y };
  }

  const margin = 20;
  if (config.position === 'bottom-left') {
    return { x: workArea.x + margin, y: workArea.y + workArea.height - petSize - margin };
  }
  // 默认 bottom-right
  return { x: workArea.x + workArea.width - petSize - margin, y: workArea.y + workArea.height - petSize - margin };
}

// 创建宠物悬浮窗
export function createPetWindow(mainWindow) {
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

  // 加载宠物渲染页面
  petWindow.loadFile(path.join(__dirname, 'pet.html'));

  // 设置窗口忽略鼠标事件（默认穿透，仅在非透明像素响应）
  petWindow.setIgnoreMouseEvents(true, { forward: true });

  // ----- 拖拽处理 -----
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let winStart = { x: 0, y: 0 };

  petWindow.webContents.on('ipc-message', (_event, channel) => {
    // 拖拽开始（由 pet-renderer.js 发起）
    if (channel === 'pet:drag-start') {
      isDragging = true;
      const bounds = petWindow.getBounds();
      winStart = { x: bounds.x, y: bounds.y };
      // 暂时禁用穿透以接收鼠标移动
      petWindow.setIgnoreMouseEvents(false);
    }
    // 拖拽结束
    if (channel === 'pet:drag-end') {
      isDragging = false;
      // 磁吸逻辑
      const bounds = petWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(bounds);
      const wa = currentDisplay.workArea;
      const snapThreshold = 20;

      let newX = bounds.x;
      let newY = bounds.y;

      // 左边缘磁吸
      if (Math.abs(bounds.x - wa.x) <= snapThreshold) {
        newX = wa.x;
      }
      // 右边缘磁吸
      if (Math.abs(bounds.x + bounds.width - (wa.x + wa.width)) <= snapThreshold) {
        newX = wa.x + wa.width - bounds.width;
      }
      // 上边缘磁吸
      if (Math.abs(bounds.y - wa.y) <= snapThreshold) {
        newY = wa.y;
      }
      // 下边缘磁吸
      if (Math.abs(bounds.y + bounds.height - (wa.y + wa.height)) <= snapThreshold) {
        newY = wa.y + wa.height - bounds.height;
      }

      if (newX !== bounds.x || newY !== bounds.y) {
        petWindow.setBounds({ x: newX, y: newY, width: bounds.width, height: bounds.height });
      }

      // 保存自定义位置
      const cfg = loadConfig();
      cfg.position = 'custom';
      cfg.customPosition = { x: newX, y: newY };
      saveConfig(cfg);

      // 恢复像素穿透
      petWindow.setIgnoreMouseEvents(true, { forward: true });
      // 通知渲染进程重算穿透
      petWindow.webContents.send('pet:enable-transparent');
    }
  });

  // ----- 主窗口跨屏时宠物跟随 -----
  let lastScreenId = null;
  const screenFollowInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const mainBounds = mainWindow.getBounds();
    const mainDisplay = screen.getDisplayMatching(mainBounds);

    if (lastScreenId && lastScreenId !== mainDisplay.id) {
      // 主窗口跨屏了，宠物跟随
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

// 根据配置更新宠物窗口（缩放/位置）
export function updatePetWindow(petWindow, config) {
  if (!petWindow || petWindow.isDestroyed()) return;

  const petSize = Math.round(192 * (config.zoom || 1.0));
  petWindow.setSize(petSize, Math.round(208 * (config.zoom || 1.0)));

  if (config.position !== 'custom') {
    const display = screen.getDisplayMatching(petWindow.getBounds());
    const pos = calcPosition(petWindow, config, display.workArea);
    petWindow.setPosition(pos.x, pos.y);
  }

  saveConfig(config);

  // 通知渲染进程更新缩放
  petWindow.webContents.send('pet:update-config', config);
}

// 发送状态事件到宠物渲染进程
export function sendPetEvent(petWindow, event) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:event', event);
  }
}

// 位置持久化
export function loadPetPosition() {
  const config = loadConfig();
  return config.customPosition || null;
}

export function savePetPosition(pos) {
  const config = loadConfig();
  config.position = 'custom';
  config.customPosition = pos;
  saveConfig(config);
}

export { loadConfig, saveConfig };
