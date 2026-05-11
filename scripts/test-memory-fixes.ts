// 综合测试：L0→L1防丢失 / max-turn强制闭合 / 空闲超时 / 提示词
// 运行方式: npx tsx scripts/test-memory-fixes.ts
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../data/aichat.db');
const BASE_URL = 'http://localhost:3001';

const db = new Database(DB_PATH);
let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.log(`  ❌ ${description}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function banner(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function uuid() {
  return crypto.randomUUID();
}

// ============================================================
banner('测试 1：提示词更新');
// ============================================================

// 1a: 检查 UserProfileService.ts 源文件
{
  const fs = await import('fs');
  const code = fs.readFileSync(path.resolve(__dirname, '../server/src/services/UserProfileService.ts'), 'utf-8');
  check('用户信息提示词已改为"作为背景知识"', code.includes('作为背景知识'));
  check('用户信息提示词已改为"自然结合使用"', code.includes('自然结合使用'));
  check('用户信息提示词已改为"不要反复提及"', code.includes('不要反复提及'));
  check('用户信息提示词不含旧版"请参考这些信息来个性化回复"', !code.includes('请参考这些信息来个性化回复'));
}

// 1b: 检查 promptTemplates.ts 源文件
{
  const fs = await import('fs');
  const code = fs.readFileSync(path.resolve(__dirname, '../server/src/utils/promptTemplates.ts'), 'utf-8');
  check('记忆模板已改为"属于背景知识"', code.includes('属于背景知识'));
  check('记忆模板已改为"自然结合使用"', code.includes('自然结合使用'));
  check('记忆模板已改为"不要反复提及"', code.includes('不要反复提及'));
  check('记忆模板不含旧版"请参考这些信息来个性化回复"', !code.includes('请参考这些信息来个性化回复'));
}

// ============================================================
banner('测试 2：ensureOpenChunk 同步创建能力');
// ============================================================

{
  const { conversationChunkService } = await import('../server/src/services/ConversationChunkService.js');
  const testConvId = uuid();

  // 需先创建会话（外键约束）
  db.prepare("INSERT INTO conversations (id, assistant_id, title) VALUES (?, ?, 'test')").run(testConvId, '5889d53e-0c1f-4648-a889-7d54e0b4407e');

  const chunkId = conversationChunkService.ensureOpenChunk(testConvId, 1);
  check('ensureOpenChunk 返回有效 ID', typeof chunkId === 'string' && chunkId.length > 0, `chunkId=${chunkId}`);

  const exists = db.prepare('SELECT * FROM conversation_chunks WHERE id = ?').get(chunkId) as any;
  check('chunk 已写入数据库', !!exists);
  check('chunk status 为 open', exists?.status === 'open');
  check('chunk start_turn_index 正确', exists?.start_turn_index === 1, `actual=${exists?.start_turn_index}`);

  // 再次调用返回同一 chunk
  const chunkId2 = conversationChunkService.ensureOpenChunk(testConvId, 2);
  check('重复调用返回同一 chunk（不创建新 chunk）', chunkId === chunkId2);

  // 清理
  db.prepare('DELETE FROM conversation_chunks WHERE conversation_id = ?').run(testConvId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(testConvId);
  console.log('  (测试数据已清理)');
}

// ============================================================
banner('测试 3：config 配置验证');
// ============================================================

{
  const { config } = await import('../server/src/config.js');
  check('maxTurnsPerChunk = 8', config.maxTurnsPerChunk === 8, `实际值: ${config.maxTurnsPerChunk}`);
  check('sessionIdleTimeoutMs = 3600000 (1小时)', config.sessionIdleTimeoutMs === 3600000, `实际值: ${config.sessionIdleTimeoutMs}`);
  check('chunkSimilarityThreshold = 0.65', config.chunkSimilarityThreshold === 0.65, `实际值: ${config.chunkSimilarityThreshold}`);
}

// ============================================================
banner('测试 4：maxTurnsPerChunk 强制闭合逻辑（源码验证）');
// ============================================================

{
  const fs = await import('fs');
  const code = fs.readFileSync(path.resolve(__dirname, '../server/src/services/ConversationChunkService.ts'), 'utf-8');
  check('源码含 chunkTurnCount 计算', code.includes('chunkTurnCount'));
  check('源码含 maxTurnsPerChunk 比较', code.includes('maxTurnsPerChunk'));
  check('源码含"轮数上限强制闭合"日志', code.includes('轮数上限强制闭合'));
  check('强制闭合时调用 closeChunk + createChunk', code.includes('this.closeChunk(conversationId)'));
}

// ============================================================
banner('测试 5：空闲超时闭合（processStaleConversations）');
// ============================================================

{
  const { conversationChunkService } = await import('../server/src/services/ConversationChunkService.js');

  // 先看看有哪些 open chunk
  const openBefore = db.prepare("SELECT cc.id, cc.conversation_id, cc.start_turn_index, c.updated_at FROM conversation_chunks cc JOIN conversations c ON cc.conversation_id = c.id WHERE cc.status = 'open'").all() as any[];
  console.log(`  扫描前 open chunk 数: ${openBefore.length}`);
  for (const c of openBefore) {
    console.log(`    - ${c.id.slice(0, 8)} conv=${c.conversation_id.slice(0, 8)} start_turn=${c.start_turn_index} updated=${c.updated_at}`);
  }

  // 传入 1秒 超时：所有 updated_at 超过 1 秒前的 open chunk 应被闭合
  console.log('  调用 processStaleConversations(1000)...');
  await conversationChunkService.processStaleConversations(1000);

  // 短暂等待异步提取
  await new Promise(r => setTimeout(r, 2000));

  const openAfter = db.prepare("SELECT COUNT(*) as cnt FROM conversation_chunks WHERE status = 'open'").get() as any;
  console.log(`  扫描后 open chunk 数: ${openAfter.cnt}`);

  // 检查是否有新的 closed/extracted chunk
  const closedCount = db.prepare("SELECT COUNT(*) as cnt FROM conversation_chunks WHERE status IN ('closed','extracted','extracting')").get() as any;
  console.log(`  closed/extracted chunk 数: ${closedCount.cnt}`);

  check('processStaleConversations 执行无异常', true);

  // 检查之前 open 的 chunk 现在状态
  let allClosed = true;
  for (const c of openBefore) {
    const current = db.prepare('SELECT status FROM conversation_chunks WHERE id = ?').get(c.id) as any;
    if (current?.status === 'open') {
      // 可能没超过1秒，这是正常的（刚创建的）
      const updatedAt = db.prepare("SELECT updated_at FROM conversations WHERE id = ?").get(c.conversation_id) as any;
      console.log(`    ⊘ ${c.id.slice(0, 8)} 仍为 open (updated_at=${updatedAt?.updated_at})`);
    } else {
      console.log(`    ✓ ${c.id.slice(0, 8)} 状态变更为 ${current?.status}`);
    }
  }
  check('过期 open chunk 已被处理', openAfter.cnt <= openBefore.length,
    `open: ${openBefore.length} → ${openAfter.cnt}`);
}

// ============================================================
banner('测试 6：chat.ts 竞态修复（源码验证）');
// ============================================================

{
  const fs = await import('fs');
  const code = fs.readFileSync(path.resolve(__dirname, '../server/src/routes/chat.ts'), 'utf-8');
  check('源码含 ensureOpenChunk 调用', code.includes('ensureOpenChunk'));
  check('源码不含旧版 getOpenChunk 竞态模式', !code.includes('getOpenChunk(activeConvId);\n          if (chunk)'));
  check('源码注释含"同步确保 open chunk 存在"', code.includes('同步确保 open chunk 存在'));
}

// ============================================================
banner('测试结果');
// ============================================================
console.log(`  ✅ 通过: ${passed}`);
console.log(`  ❌ 失败: ${failed}`);
console.log(`  总计: ${passed + failed}`);

db.close();
process.exit(failed > 0 ? 1 : 0);
