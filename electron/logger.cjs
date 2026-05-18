// 宠物系统统一日志模块 — 写入 ~/.aichat/logs/pet-YYYY-MM-DD.log
// 同时输出到 console，方便 dev 模式下查看

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const LOG_DIR = path.join(home, '.aichat', 'logs');

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `pet-${date}.log`);
}

function formatTime() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function writeLog(level, tag, msg) {
  ensureDir();
  const line = `[${formatTime()}] [${level}] [${tag}] ${msg}\n`;
  try {
    fs.appendFileSync(getLogFile(), line, 'utf-8');
  } catch {
    // 写日志失败不影响主流程
  }
  // 同步输出到控制台
  const prefix = `[PetLog][${level}][${tag}]`;
  if (level === 'ERROR') {
    console.error(prefix, msg);
  } else if (level === 'WARN') {
    console.warn(prefix, msg);
  } else {
    console.log(prefix, msg);
  }
}

function info(tag, msg)  { writeLog('INFO',  tag, msg); }
function warn(tag, msg)  { writeLog('WARN',  tag, msg); }
function error(tag, msg) { writeLog('ERROR', tag, msg); }
function debug(tag, msg) { writeLog('DEBUG', tag, msg); }

// 获取最近 N 行日志（供前端查看）
function tail(n = 50) {
  try {
    ensureDir();
    const file = getLogFile();
    if (!fs.existsSync(file)) return '';
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.trim().split('\n');
    return lines.slice(-n).join('\n');
  } catch {
    return '(无法读取日志)';
  }
}

module.exports = { info, warn, error, debug, tail, LOG_DIR };
