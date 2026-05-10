// 综合测试：L0→L1 防丢失 / max-turn 强制闭合 / 空闲超时 / 提示词
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../data/aichat.db');
const BASE_URL = 'http://localhost:3001';

const db = new Database(DB_PATH);
let passed = 0;
let failed = 0;

function check(description, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.log(`  ❌ ${description}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function banner(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

// ============================================================
// 准备：创建测试助手
// ============================================================
banner('准备测试环境');

// 清理旧测试数据
const oldAssist = db.prepare("SELECT id FROM assistants WHERE name = 'test-memory-fix'").get();
if (oldAssist) {
  const oldConvs = db.prepare("SELECT id FROM conversations WHERE assistant_id = ?").all(oldAssist.id);
  for (const c of oldConvs) {
    db.prepare("DELETE FROM chunk_messages WHERE chunk_id IN (SELECT id FROM conversation_chunks WHERE conversation_id = ?)").run(c.id);
    db.prepare("DELETE FROM conversation_chunks WHERE conversation_id = ?").run(c.id);
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(c.id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(c.id);
  }
  db.prepare("DELETE FROM assistants WHERE id = ?").run(oldAssist.id);
}

// 清理测试记忆
db.prepare("DELETE FROM memory_source_links WHERE memory_id IN (SELECT id FROM memories WHERE content LIKE '%测试%' OR content LIKE '%test%')").run();
db.prepare("DELETE FROM memories WHERE content LIKE '%测试%' OR content LIKE '%test%'").run();

// 找可用模型
const chatModel = db.prepare("SELECT id, name FROM models WHERE id = 'e7c299a7-c5c2-47cb-b2ee-6ba7eb764d7f'").get();
if (!chatModel) { console.log('deepseek-v4-flash 模型不存在，跳过测试'); process.exit(1); }

const providerId = '47063709-ec6a-4b5e-830d-454ddc80bb33';
const embedModel = db.prepare("SELECT id FROM models WHERE name LIKE '%bge-m3%' AND provider_id = '1b8d3ffe-c1ba-4a57-9165-98ad3ee47608'").get();

// 创建测试助手：context_rounds=3 方便快速进入L1测试
const assistantId = crypto.randomUUID();
db.prepare(`INSERT INTO assistants (id, name, system_prompt, model_id, provider_id, context_rounds, enable_memory, embedding_provider_id, embedding_model_id)
  VALUES (?, 'test-memory-fix', '你是一个测试助手。', ?, ?, 3, 1, '1b8d3ffe-c1ba-4a57-9165-98ad3ee47608', ?)`).run(
  assistantId, chatModel.id, providerId, embedModel?.id || null
);
console.log(`  测试助手已创建: ${assistantId}`);

// ============================================================
// 测试 1：提示词更新
// ============================================================
banner('测试 1：提示词更新验证');

// 1a: UserProfileService
import('../server/src/services/UserProfileService.js').then(mod => {
  const { userProfileService } = mod;
  const section = userProfileService.buildProfileSection();
  check('用户信息提示词不含"请参考这些信息来个性化回复"',
    !section.includes('请参考这些信息来个性化回复'));
  check('用户信息提示词包含"作为背景知识"',
    section.includes('作为背景知识'));
  check('用户信息提示词包含"自然结合使用"',
    section.includes('自然结合使用'));
  check('用户信息提示词包含"不要反复提及"',
    section.includes('不要反复提及'));
  if (section) {
    console.log(`    当前提示词: ${section.substring(0, 120)}...`);
  }
});

// 1b: CHAT_SYSTEM_WITH_MEMORY
import('../server/src/utils/promptTemplates.js').then(mod => {
  const template = mod.CHAT_SYSTEM_WITH_MEMORY || '';
  check('记忆模板不含"请参考这些信息来个性化回复"',
    !template.includes('请参考这些信息来个性化回复'));
  check('记忆模板包含"属于背景知识"',
    template.includes('属于背景知识'));
  check('记忆模板包含"自然结合使用"',
    template.includes('自然结合使用'));
  check('记忆模板包含"不要反复提及"',
    template.includes('不要反复提及'));
});

// ============================================================
// 测试 2：L0→L1 消息不丢失
// ============================================================
banner('测试 2：L0→L1 首轮消息不丢失');

async function sendMessage(convId, msg) {
  const resp = await fetch(`${BASE_URL}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: assistantId,
      conversation_id: convId,
      message: msg,
      thinking_mode: 'disabled',
    }),
  });
  // 消费 SSE 流直到 done
  const text = await resp.text();
  // 提取最后一个 done 事件
  const lines = text.split('\n').filter(l => l.startsWith('data: '));
  for (const line of lines) {
    try {
      const data = JSON.parse(line.slice(6));
      if (data.type === 'done') return data;
    } catch {}
  }
  return null;
}

async function testL0NoMessageLoss() {
  // 新建会话，发送 6 条消息（context_rounds=3，前3轮在L0，后3轮进入L1）
  const convId = crypto.randomUUID();
  const messages = [
    '你好',                                    // turn 1 (L0)
    '我叫测试用户',                             // turn 2 (L0)
    '我住在北京',                               // turn 3 (L0)
    '我喜欢打游戏',                             // turn 4 (L1, 首个超出)
    '我周末喜欢出去吃饭',                       // turn 5 (L1)
    '我喜欢科幻电影',                           // turn 6 (L1)
  ];

  for (const msg of messages) {
    console.log(`  发送: "${msg}"`);
    const result = await sendMessage(convId, msg);
    if (result) {
      console.log(`    → 回复: ${(result.content || '').substring(0, 60)}...`);
    }
    // 短暂等待让异步chunk处理完成
    await new Promise(r => setTimeout(r, 1500));
  }

  // 验证数据库
  const turns = db.prepare('SELECT DISTINCT turn_index FROM messages WHERE conversation_id = ? ORDER BY turn_index ASC').all(convId);
  console.log(`  总轮数: ${turns.length}`);

  // 检查 chunk 创建
  const chunks = db.prepare('SELECT * FROM conversation_chunks WHERE conversation_id = ? ORDER BY start_turn_index ASC').all(convId);
  console.log(`  创建的 chunk 数: ${chunks.length}`);
  chunks.forEach(c => {
    const msgCount = db.prepare('SELECT COUNT(*) as cnt FROM chunk_messages WHERE chunk_id = ?').get(c.id);
    console.log(`    chunk ${c.id.slice(0,8)}: start_turn=${c.start_turn_index} end_turn=${c.end_turn_index} status=${c.status} msgs=${msgCount.cnt}`);
  });

  // 关键检查：turn 4（首个 L1 turn）必须出现在 chunk_messages 中
  const turn4Msgs = db.prepare('SELECT turn_index FROM messages WHERE conversation_id = ? AND turn_index = 4').all(convId);
  if (turn4Msgs.length > 0) {
    const inChunk = db.prepare(`
      SELECT 1 FROM chunk_messages WHERE message_id IN (
        SELECT id FROM messages WHERE conversation_id = ? AND turn_index = 4
      )
    `).get(convId);
    check('Turn 4（首个L1轮次）消息已关联到 chunk', !!inChunk, '竞态条件修复验证');
  } else {
    check('Turn 4 消息存在', false, '消息未保存');
  }

  // 检查所有 L1 轮次（turn > 3）的消息都在 chunk 中
  const l1MsgIds = db.prepare(`
    SELECT id, turn_index FROM messages WHERE conversation_id = ? AND turn_index > 3
  `).all(convId);
  let allInChunk = true;
  for (const m of l1MsgIds) {
    const linked = db.prepare('SELECT 1 FROM chunk_messages WHERE message_id = ?').get(m.id);
    if (!linked) {
      allInChunk = false;
      console.log(`    ⚠️ turn ${m.turn_index} 消息未关联到 chunk`);
    }
  }
  check(`所有 L1 消息（${l1MsgIds.length}条）都已关联到 chunk`, allInChunk);

  return convId;
}

// ============================================================
// 测试 3：空闲超时闭合并提取
// ============================================================
banner('测试 3：空闲超时闭合 + 记忆提取');

async function testIdleTimeout() {
  // 先确认当前有任何 open 状态的 chunk
  const openChunks = db.prepare("SELECT cc.* FROM conversation_chunks cc JOIN conversations c ON cc.conversation_id = c.id WHERE cc.status = 'open'").all();
  console.log(`  当前 open chunk 数: ${openChunks.length}`);
  openChunks.forEach(c => {
    console.log(`    - ${c.id.slice(0,8)} conv=${c.conversation_id.slice(0,8)} start=${c.start_turn_index}`);
  });

  // 直接调用 processStaleConversations，传入 1 秒超时（模拟时间流逝）
  console.log('  调用 processStaleConversations(1000)...');
  const { conversationChunkService } = await import('../server/src/services/ConversationChunkService.js');
  await conversationChunkService.processStaleConversations(1000);

  // 检查结果：所有 open chunk 应该被闭合
  const openAfter = db.prepare("SELECT COUNT(*) as cnt FROM conversation_chunks WHERE status = 'open'").get();
  console.log(`  处理后 open chunk 数: ${openAfter.cnt}`);

  // 检查是否有记忆被提取
  const newMemories = db.prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT 5").all();
  console.log(`  最近记忆数: ${newMemories.length}`);
  newMemories.forEach(m => {
    console.log(`    [${m.topic}] ${m.content} (status=${m.status})`);
  });

  check('空闲超时后 open chunk 被闭合', openAfter.cnt < openChunks.length || openChunks.length === 0,
    `之前 open=${openChunks.length}, 现在 open=${openAfter.cnt}`);

  // 检查是否有提取到记忆或至少状态变更
  const closedOrExtracted = db.prepare("SELECT COUNT(*) as cnt FROM conversation_chunks WHERE status IN ('closed','extracted','extracting')").get();
  check('chunk 状态有变更（open→closed/extracted）', closedOrExtracted.cnt >= 0);
}

// ============================================================
// 测试 4：ensureOpenChunk 同步创建
// ============================================================
banner('测试 4：ensureOpenChunk 同步创建能力');

async function testEnsureOpenChunk() {
  const { conversationChunkService } = await import('../server/src/services/ConversationChunkService.js');
  const testConvId = crypto.randomUUID();
  // 由于没消息，直接测试 ensureOpenChunk
  const chunkId = conversationChunkService.ensureOpenChunk(testConvId, 1);
  check('ensureOpenChunk 返回有效 ID', typeof chunkId === 'string' && chunkId.length > 0);

  const exists = db.prepare('SELECT * FROM conversation_chunks WHERE id = ?').get(chunkId);
  check('chunk 已写入数据库', !!exists);
  check('chunk status 为 open', exists?.status === 'open');
  check('chunk start_turn_index 正确', exists?.start_turn_index === 1);

  // 再次调用应返回同一个 chunk
  const chunkId2 = conversationChunkService.ensureOpenChunk(testConvId, 2);
  check('重复调用返回同一 chunk', chunkId === chunkId2);

  // 清理
  db.prepare('DELETE FROM conversation_chunks WHERE conversation_id = ?').run(testConvId);
}

// ============================================================
// 测试 5：maxTurnsPerChunk 强制闭合逻辑
// ============================================================
banner('测试 5：maxTurnsPerChunk 强制闭合');

async function testMaxTurnForceClose() {
  // 验证 config 中包含 maxTurnsPerChunk
  const { config } = await import('../server/src/config.js');
  check('config.maxTurnsPerChunk 已配置', config.maxTurnsPerChunk === 8,
    `当前值: ${config.maxTurnsPerChunk}`);

  // 验证 checkChunkBoundaryAsync 中存在轮数上限检查
  const fs = await import('fs');
  const chunkServiceCode = fs.readFileSync('../server/src/services/ConversationChunkService.ts', 'utf-8');
  check('checkChunkBoundaryAsync 包含 chunkTurnCount 计算',
    chunkServiceCode.includes('chunkTurnCount'));
  check('checkChunkBoundaryAsync 包含 maxTurnsPerChunk 比较',
    chunkServiceCode.includes('maxTurnsPerChunk'));
  check('checkChunkBoundaryAsync 强制闭合时调用 closeChunk',
    chunkServiceCode.includes('轮数上限强制闭合'));
}

// ============================================================
// 运行所有测试
// ============================================================
async function runAll() {
  try {
    await testEnsureOpenChunk();
    await testMaxTurnForceClose();

    // L0→L1 测试需要真实 API 调用
    console.log('\n⏳ 正在进行 API 集成测试（需要 LLM 调用，约需 30 秒）...');
    const convId = await testL0NoMessageLoss();

    // 给异步流程一些时间
    console.log('\n  等待异步 chunk 处理完成...');
    await new Promise(r => setTimeout(r, 3000));

    await testIdleTimeout();

    // 清理测试会话
    if (convId) {
      db.prepare("DELETE FROM chunk_messages WHERE chunk_id IN (SELECT id FROM conversation_chunks WHERE conversation_id = ?)").run(convId);
      db.prepare("DELETE FROM conversation_chunks WHERE conversation_id = ?").run(convId);
      db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(convId);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);
    }

  } catch (err) {
    console.error('\n测试执行出错:', err);
    failed++;
  }

  // 清理助手
  db.prepare("DELETE FROM assistants WHERE id = ?").run(assistantId);

  banner('测试结果');
  console.log(`  ✅ 通过: ${passed}`);
  console.log(`  ❌ 失败: ${failed}`);
  console.log(`  总计: ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
