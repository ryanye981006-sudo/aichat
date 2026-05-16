import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { config } from './config.js';
import { getDb, closeDb } from './db/connection.js';

import assistantsRouter from './routes/assistants.js';
import conversationsRouter from './routes/conversations.js';
import messagesRouter from './routes/messages.js';
import chatRouter from './routes/chat.js';
import providersRouter from './routes/providers.js';
import modelsRouter from './routes/models.js';
import memoryRouter from './routes/memory.js';
// import knowledgeRouter from './routes/knowledge.js';
import profileRouter from './routes/profile.js';
import settingsRouter from './routes/settings.js';
import toolsRouter from './routes/tools.js';
import petsRouter from './routes/pets.js';
import { conversationIdleDetector } from './services/ConversationIdleDetector.js';
import { webSearchService } from './services/WebSearchService.js';

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化数据库连接
getDb();

// 启动空闲会话检测器（触发 B：会话空闲超时→强制提取记忆）
conversationIdleDetector.start();

// 初始化搜索引擎：优先从数据库加载用户通过 UI 保存的 IQS Key，否则回退到 .env
const dbIqsRow = getDb().prepare("SELECT value FROM user_profile WHERE key = 'iqs_api_key'").get() as any;
const iqsKey = dbIqsRow?.value || config.iqsApiKey;
webSearchService.initFromConfig(iqsKey);

// API 路由
app.use('/api/assistants', assistantsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/providers', providersRouter);
app.use('/api/models', modelsRouter);
app.use('/api/memory', memoryRouter);
// app.use('/api/knowledge', knowledgeRouter);
app.use('/api/profile', profileRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/pets', petsRouter);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

let server: ReturnType<typeof createServer>;

function startServer(retries = 10) {
  server = createServer(app);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && retries > 0) {
      const delay = Math.min(1000 * Math.pow(1.5, 10 - retries), 8000);
      console.log(`[Server] 端口 ${config.port} 被占用，${Math.round(delay / 1000)}秒后重试 (剩余 ${retries - 1} 次)...`);
      setTimeout(() => {
        server.close();
        startServer(retries - 1);
      }, delay);
      return;
    }
    throw err;
  });

  server.listen(config.port, () => {
    console.log(`[Server] aichat API 已启动: http://localhost:${config.port}`);
    console.log(`[Server] 数据库: ${config.dbPath}`);
  });
}

startServer();

function shutdown(signal: string) {
  console.log(`[Server] 收到 ${signal}，正在关闭...`);
  try { closeDb(); } catch {}
  if (server) {
    server.close(() => process.exit(0));
  }
  // 兜底：1 秒后强制退出（比原来更快，让 tsx watch 更快拿到端口）
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
