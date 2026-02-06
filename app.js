import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRoutes from './src/api/routes.js';
import { requestLogger } from './src/middleware/logging.js';
import { apiRateLimit } from './src/middleware/rateLimit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.join(__dirname, 'src', 'frontend');

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestLogger);
  app.use(apiRateLimit);

  app.use(express.static(frontendDir));
  app.use('/', apiRoutes);

  return app;
}
