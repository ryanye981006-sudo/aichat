import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

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
  let child: ChildProcess;

  if (isDev) {
    // 开发模式：用 npx tsx 运行 TS 源码
    child = spawn('npx', ['tsx', path.join(__dirname, '../server/src/index.ts')], {
      env: { ...process.env },
      stdio: 'pipe',
    });
  } else {
    // 生产模式：用内嵌的便携 Node.js 运行编译后的 server-dist
    // 避开 Electron 内嵌 Node.js 的 V8 ABI 兼容问题
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

  child.stdout?.on('data', (data: Buffer) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    console.error(`[Server] ${data.toString().trim()}`);
  });
  child.on('exit', (code: number | null) => {
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

  startServer();
  // 给服务端一点启动时间
  setTimeout(createWindow, 2000);
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
