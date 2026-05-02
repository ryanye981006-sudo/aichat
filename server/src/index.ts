import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { getDb, closeDb } from './db/connection.js';

import assistantsRouter from './routes/assistants.js';
import conversationsRouter from './routes/conversations.js';
import messagesRouter from './routes/messages.js';
import chatRouter from './routes/chat.js';
import providersRouter from './routes/providers.js';
import modelsRouter from './routes/models.js';
import memoryRouter from './routes/memory.js';
import knowledgeRouter from './routes/knowledge.js';

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化数据库连接
getDb();

// API 路由
app.use('/api/assistants', assistantsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/providers', providersRouter);
app.use('/api/models', modelsRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/knowledge', knowledgeRouter);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// 启动
const server = app.listen(config.port, () => {
  console.log(`[Server] aichat API 已启动: http://localhost:${config.port}`);
  console.log(`[Server] 数据库: ${config.dbPath}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[Server] 正在关闭...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] 正在关闭...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
});

export default app;
