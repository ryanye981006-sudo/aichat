import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../data/aichat.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.resolve(__dirname, '../../uploads'),
  defaultEmbeddingDim: 1536,
  defaultChunkSize: 512,
  defaultChunkOverlap: 50,
  defaultSearchTopK: 5,
  defaultSimilarityThreshold: 0.7,
  memorySimilarityThreshold: 0.85,
  memoryExtractRounds: 10,

  // 三层时间模型（L0 轮数从助手 context_rounds 读取，此处不再写死）
  chunkSimilarityThreshold: 0.65,
  maxTurnsPerChunk: 8,                  // chunk 轮数上限，超过强制闭合
  sessionIdleTimeoutMs: 3600000,       // 1 小时
  llmTimeoutMs: 300000,                  // LLM 调用超时（聊天 + 记忆提取）

  // 时间衰减
  timeDecayHalfLifeDays: 60,
  recencyDecayRate: 0.01,               // 每小时 λ
  frequencyGrowthRate: 0.1,             // μ

  // RRF 融合
  rrfSmoothingFactor: 60,

  // 检索管线 top-N
  channelTopN: 15,
  rrfTopN: 20,
  rerankerTopN: 10,
  searchResultLimit: 5,

  // 五信号权重
  signalWeights: {
    semantic: 0.35,
    recency: 0.20,
    timeDecay: 0.20,
    frequency: 0.10,
    importance: 0.15,
  },

  // 知识库多模态 embedding（阿里云 DashScope）
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  dashscopeBaseUrl: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding',
  dashscopeModel: 'qwen3-vl-embedding',
  dashscopeDimension: 2560,

  // 重排序（硅基流动）
  siliconflowApiKey: process.env.SILICONFLOW_API_KEY || '',
  siliconflowBaseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
  siliconflowRerankModel: process.env.SILICONFLOW_RERANK_MODEL || 'BAAI/bge-reranker-v2-m3',

  // MinerU 预处理
  mineruJwt: process.env.MINERU_JWT || '',
  mineruBaseUrl: 'https://mineru.net/api/v4/extract/task',

  // DeepSeek-OCR（硅基流动，替代 MinerU）
  ocrModel: process.env.SILICONFLOW_OCR_MODEL || 'deepseek-ai/DeepSeek-OCR',
  ocrPrompt: process.env.OCR_PROMPT || '<image>\nFree OCR.',
};
