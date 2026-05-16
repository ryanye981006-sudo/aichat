// 全屏检测器 — 500ms 轮询检测独占全屏应用 (CommonJS)
const { BrowserWindow, screen } = require('electron');

let intervalId = null;
let wasHidden = false;

function isExclusiveFullscreen(fgWin, mainWindow, petWindow) {
  if (!fgWin || fgWin === mainWindow || fgWin === petWindow) return false;
  try {
    const bounds = fgWin.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const sizeMatch =
      Math.abs(bounds.width - display.size.width) <= 2 &&
      Math.abs(bounds.height - display.size.height) <= 2;
    if (!sizeMatch) return false;
    const title = fgWin.getTitle();
    if (!title || title === 'Program Manager') return false;
    return true;
  } catch {
    return false;
  }
}

function startFullscreenDetection(mainWindow, petWindow) {
  if (intervalId) return;
  intervalId = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const fgWin = BrowserWindow.getFocusedWindow();
    const fullscreen = isExclusiveFullscreen(fgWin, mainWindow, petWindow);
    if (fullscreen && !wasHidden) {
      petWindow.hide();
      petWindow.webContents.send('pet:pause-render');
      wasHidden = true;
    } else if (!fullscreen && wasHidden) {
      petWindow.show();
      petWindow.webContents.send('pet:resume-render');
      wasHidden = false;
    }
  }, 500);
}

function stopFullscreenDetection() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  wasHidden = false;
}

module.exports = { startFullscreenDetection, stopFullscreenDetection };
