// 构建打包脚本：裁剪 devDeps → 打包 → 恢复依赖
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const electronVersion = pkg.devDependencies?.electron?.replace(/^[\^~]/, '') || '42.0.1';

console.log('[build] 裁剪开发依赖...');
execSync('npm prune --production', { stdio: 'inherit' });

try {
  console.log('[build] 运行 electron-builder (Electron %s)...', electronVersion);
  execSync(`npx electron-builder@26.8.1 -c.electronVersion=${electronVersion}`, { stdio: 'inherit' });
  console.log('[build] 打包完成');
} finally {
  console.log('[build] 恢复全部依赖...');
  execSync('npm install', { stdio: 'inherit' });
  console.log('[build] 依赖已恢复');
}
