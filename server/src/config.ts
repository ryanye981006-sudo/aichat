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
};
