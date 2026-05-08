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
};
