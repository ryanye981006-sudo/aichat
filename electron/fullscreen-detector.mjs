// 全屏检测器 — 500ms 轮询检测独占全屏应用
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BrowserWindow, screen } = require('electron');

let intervalId = null;
let wasHidden = false;

// 检测前台窗口是否为独占全屏
function isExclusiveFullscreen(fgWin, mainWindow, petWindow) {
  // 排除 aichat 自己的窗口
  if (!fgWin || fgWin === mainWindow || fgWin === petWindow) return false;

  try {
    const bounds = fgWin.getBounds();
    const display = screen.getDisplayMatching(bounds);

    // 前台窗口尺寸必须等于该显示器分辨率（误差 ≤2px）
    const sizeMatch =
      Math.abs(bounds.width - display.size.width) <= 2 &&
      Math.abs(bounds.height - display.size.height) <= 2;

    if (!sizeMatch) return false;

    // 排除桌面窗口（explorer.exe 的 Progman/WorkerW）
    const title = fgWin.getTitle();
    if (!title || title === 'Program Manager') return false;

    return true;
  } catch {
    return false;
  }
}

// 启动全屏检测
export function startFullscreenDetection(mainWindow, petWindow) {
  if (intervalId) return;

  intervalId = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return;

    const fgWin = BrowserWindow.getFocusedWindow();
    const fullscreen = isExclusiveFullscreen(fgWin, mainWindow, petWindow);

    if (fullscreen && !wasHidden) {
      // 进入全屏 — 隐藏宠物 + 停止渲染
      petWindow.hide();
      petWindow.webContents.send('pet:pause-render');
      wasHidden = true;
    } else if (!fullscreen && wasHidden) {
      // 退出全屏 — 恢复宠物
      petWindow.show();
      petWindow.webContents.send('pet:resume-render');
      wasHidden = false;
    }
  }, 500);
}

// 停止全屏检测
export function stopFullscreenDetection() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  wasHidden = false;
}
