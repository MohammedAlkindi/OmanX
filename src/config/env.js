import dotenv from 'dotenv';

dotenv.config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),
  adminToken: process.env.ADMIN_TOKEN || 'dev-admin-token',
  apiKey: process.env.OPENAI_API_KEY || '',
  requestLimit: toInt(process.env.RATE_LIMIT_MAX, 100),
  requestWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
};

export const isProd = env.nodeEnv === 'production';
