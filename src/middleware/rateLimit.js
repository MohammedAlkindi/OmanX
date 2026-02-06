import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const apiRateLimit = rateLimit({
  windowMs: env.requestWindowMs,
  max: env.requestLimit,
  standardHeaders: true,
  legacyHeaders: false,
});
