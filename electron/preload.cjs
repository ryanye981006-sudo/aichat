const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- 窗口控制 ----
  isElectron: true,
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  onFullscreenChange: (callback) => {
    ipcRenderer.on('fullscreen-changed', (_event, isFullscreen) => callback(isFullscreen));
  },

  // ---- 宠物管理（主窗口使用） ---
  petActivate: (petData) => ipcRenderer.send('pet:activate', petData),
  petDeactivate: () => ipcRenderer.send('pet:deactivate'),
  petUpdateConfig: (config) => ipcRenderer.send('pet:update-config', config),
  petListInstalled: () => ipcRenderer.invoke('pet:list-installed'),
  petImportLocal: (sourceDir) => ipcRenderer.invoke('pet:import-local', sourceDir),
  petDelete: (petId) => ipcRenderer.invoke('pet:delete', petId),
  petTailLog: (lines) => ipcRenderer.invoke('pet:tail-log', lines || 50),
  petGetConfig: () => ipcRenderer.invoke('pet:get-config'),

  // ---- 宠物渲染进程：读取文件（IPC invoke，Buffer 自动序列化，无大小限制） ---
  petReadFile: (filePath) => ipcRenderer.invoke('pet:read-file', filePath),

  // ---- 宠物状态事件（宠物渲染进程使用） ----
  onPetEvent: (callback) => {
    ipcRenderer.on('pet:event', (_event, data) => callback(data));
  },
  onPetLoad: (callback) => {
    ipcRenderer.on('pet:load', (_event, data) => callback(data));
  },
  onPetConfigUpdate: (callback) => {
    ipcRenderer.on('pet:update-config', (_event, config) => callback(config));
  },
  onPetPauseRender: (callback) => {
    ipcRenderer.on('pet:pause-render', () => callback());
  },
  onPetResumeRender: (callback) => {
    ipcRenderer.on('pet:resume-render', () => callback());
  },
  onPetEnableTransparent: (callback) => {
    ipcRenderer.on('pet:enable-transparent', () => callback());
  },

  // ---- 宠物交互（宠物渲染进程 → 主进程） ----
  sendPetAction: (action) => ipcRenderer.send('pet:action', action),
  sendDragStart: () => ipcRenderer.send('pet:drag-start'),
  sendDragEnd: () => ipcRenderer.send('pet:drag-end'),
});
