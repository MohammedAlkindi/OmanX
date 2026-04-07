// config/env.js - 

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (one level up from config/)
dotenv.config({ path: path.join(__dirname, '..', '.env') });