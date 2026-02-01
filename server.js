// server.js — OmanX MVP (Advanced, root-based, Express 5-safe)
// Goals:
// - Production-grade middleware (security, rate limit, logging, compression)
// - Root-directory static serving (index.html, styles.css, app.js all in root)
// - OpenAI Responses API (correct content types)
// - Optional SSE streaming
// - Knowledge.json hot-reload + caching
// - Strong error handling + graceful shutdown
//
// IMPORTANT:
// - prompts.js must export:
//   - SYSTEM_POLICY_SCHOLAR
//   - SYSTEM_POLICY_LOCAL
//   - buildKnowledgeText
//
// Deployment note:
// - If frontend and backend are on different domains, set:
//   ALLOWED_ORIGINS=https://your-frontend-domain,https://www.your-frontend-domain

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs/promises";
import crypto from "crypto";

import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import winston from "winston";

import {
  SYSTEM_POLICY_SCHOLAR,
  SYSTEM_POLICY_LOCAL,
  buildKnowledgeText,
} from "./prompts.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120); // per 15 min
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000); // 10 min
const CACHE_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);

const KNOWLEDGE_PATH = path.join(__dirname, "knowledge.json");
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // optional; used for admin endpoints in prod

// -----------------------------
// Logger (Winston)
// -----------------------------
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (IS_PROD ? "info" : "debug"),
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "omanx" },
  transports: [
    new winston.transports.Console({
      format: IS_PROD
        ? winston.format.json()
        : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

// -----------------------------
// Config validation
// -----------------------------
function requireEnv(name) {
  if (!process.env[name]) {
    logger.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}
requireEnv("OPENAI_API_KEY");

// -----------------------------
// OpenAI client
// -----------------------------
const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
  timeout: 60_000,
  maxRetries: 2,
});

// -----------------------------
// Intent routing (simple MVP)
// -----------------------------
function isLocalLifeQuery(text = "") {
  const t = String(text).toLowerCase();

  const localHits = [
    "restaurant",
    "restaurants",
    "food",
    "eat",
    "nearby",
    "near me",
    "cafe",
    "coffee",
    "pizza",
    "bar",
    "brunch",
    "gym",
    "grocery",
    "supermarket",
    "laundry",
    "philly",
    "philadelphia",
    "spring garden",
    "center city",
    "rittenhouse",
    "fishtown",
    "old city",
    "university city",
    "things to do",
    "recommend",
    "recommendation",
  ];

  const governedHits = [
    "i-20",
    "ds-2019",
    "sevis",
    "dso",
    "visa",
    "immigration",
    "status",
    "work authorization",
    "opt",
    "cpt",
    "legal",
    "police",
    "emergency",
    "911",
    "insurance",
    "medical",
    "hospital",
    "scholarship",
    "ministry",
    "funding",
    "reimbursement",
    "housing contract",
    "lease",
  ];

  if (governedHits.some((k) => t.includes(k))) return false;
  return localHits.some((k) => t.includes(k));
}

// -----------------------------
// Knowledge base manager (hot reload + safe fallback)
// -----------------------------
class KnowledgeManager {
  constructor(filePath) {
    this.filePath = filePath;
    this.lastMtimeMs = 0;
    this.knowledgeJson = null;
    this.knowledgeText = "";
  }

  async load(force = false) {
    const st = await fs.stat(this.filePath);
    if (!force && st.mtimeMs <= this.lastMtimeMs && this.knowledgeJson) return false;

    const raw = await fs.readFile(this.filePath, "utf8");
    const json = JSON.parse(raw);

    this.knowledgeJson = json;
    this.knowledgeText = buildKnowledgeText(json);
    this.lastMtimeMs = st.mtimeMs;

    logger.info("Knowledge loaded", {
      entries: typeof json === "object" && json ? Object.keys(json).length : 0,
      mtimeMs: st.mtimeMs,
      bytes: raw.length,
    });

    return true;
  }

  getText() {
    return this.knowledgeText || "";
  }

  getJson() {
    return this.knowledgeJson;
  }
}

const knowledge = new KnowledgeManager(KNOWLEDGE_PATH);

// -----------------------------
// Simple in-memory response cache (LRU-ish)
// -----------------------------
class ResponseCache {
  constructor({ ttlMs, maxEntries }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map(); // key -> { ts, value }
  }

  keyFor({ model, message, mode, lane }) {
    return crypto
      .createHash("sha256")
      .update(`${model}::${mode || ""}::${lane || ""}::${message}`)
      .digest("hex");
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;

    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return null;
    }

    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);

    return entry.value;
  }

  set(key, value) {
    this.map.set(key, { ts: Date.now(), value });

    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey) this.map.delete(oldestKey);
    }
  }

  clear() {
    this.map.clear();
  }

  stats() {
    return {
      size: this.map.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }
}

const cache = new ResponseCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

// -----------------------------
// Express app
// -----------------------------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// CORS
app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin / curl / server-to-server requests
      if (!origin) return cb(null, true);

      // if not configured, default open for MVP
      if (!ALLOWED_ORIGINS.length) return cb(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "POST"],
  })
);

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: "1mb" }));

// Request IDs
app.use((req, res, next) => {
  const rid =
    req.headers["x-request-id"]?.toString() ||
    crypto.randomBytes(8).toString("hex");
  req.requestId = rid;
  res.setHeader("X-Request-ID", rid);
  next();
});

// Request logging (morgan -> winston)
app.use(
  morgan("combined", {
    stream: {
      write: (msg) => logger.info(msg.trim()),
    },
    skip: () => IS_PROD === false,
  })
);

// Rate limiting (apply to API)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  handler: (req, res) => {
    logger.warn("Rate limit exceeded", { requestId: req.requestId, ip: req.ip });
    res.status(429).json({ error: "Too many requests. Please try again later." });
  },
});

// Static: root directory assets (index.html, styles.css, app.js at root)
app.use(
  express.static(__dirname, {
    etag: true,
    lastModified: true,
    maxAge: IS_PROD ? "1h" : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    },
  })
);

app.get("/pitch", (req, res) => {
  res.sendFile(path.join(__dirname, "pitch.html"));
});

// -----------------------------
// Startup load knowledge (do NOT crash prod if knowledge is missing)
// -----------------------------
try {
  await knowledge.load(true);
} catch (e) {
  logger.error("Failed to load knowledge.json at startup", { error: e?.message || String(e) });
  // Keep server alive so /health can show the issue.
}

// Periodic hot reload check
setInterval(async () => {
  try {
    await knowledge.load(false);
  } catch (e) {
    logger.error("Knowledge reload failed", { error: e?.message || String(e) });
  }
}, Number(process.env.KNOWLEDGE_RELOAD_MS || 30_000));

// -----------------------------
// Health & diagnostics
// -----------------------------
app.get("/health", async (req, res) => {
  try {
    let st = null;
    try {
      st = await fs.stat(KNOWLEDGE_PATH);
    } catch {
      st = null;
    }

    res.json({
      ok: true,
      env: NODE_ENV,
      uptime_s: Math.round(process.uptime()),
      requestId: req.requestId,
      openai: {
        configured: !!OPENAI_API_KEY,
        model: OPENAI_MODEL,
      },
      knowledge: {
        loaded: !!knowledge.getJson(),
        mtimeMs: st?.mtimeMs ?? null,
      },
      cache: cache.stats(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "health failed", requestId: req.requestId });
  }
});

app.get("/ready", (req, res) => {
  const ready = !!knowledge.getJson() && !!OPENAI_API_KEY;
  res.status(ready ? 200 : 503).json({ ready, requestId: req.requestId });
});

app.get("/metrics", (req, res) => {
  res.json({
    requestId: req.requestId,
    cache: cache.stats(),
    server: {
      env: NODE_ENV,
      uptime_s: Math.round(process.uptime()),
      memory: process.memoryUsage(),
    },
  });
});

// -----------------------------
// Admin endpoints
// - In production: requires ADMIN_KEY via x-admin-key header OR {adminKey} body
// -----------------------------
function requireAdmin(req, res, next) {
  if (!IS_PROD) return next();
  const key = (req.headers["x-admin-key"] || req.body?.adminKey || "").toString();
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized", requestId: req.requestId });
  }
  next();
}

app.post("/admin/cache/clear", requireAdmin, (req, res) => {
  cache.clear();
  res.json({ ok: true, requestId: req.requestId });
});

app.post("/admin/knowledge/reload", requireAdmin, async (req, res) => {
  try {
    const updated = await knowledge.load(true);
    res.json({ ok: true, updated, requestId: req.requestId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "reload failed", requestId: req.requestId });
  }
});

// -----------------------------
// Chat endpoint
// Body: { message: string, stream?: boolean, mode?: "official"|"community" }
// - "mode" is user-facing; "lane" is internal routing (scholar vs local).
//
// Improvements vs previous:
// - Returns more specific errors (auth/rate-limit/timeouts)
// - Includes requestId + lane in responses to help frontend debug
// - Avoids hard-failing when knowledge isn't loaded (still answers in scholar lane, but warns/esc)
 // -----------------------------
app.post("/chat", apiLimiter, async (req, res) => {
  const requestId = req.requestId;

  try {
    const { message, stream = false, mode = "official" } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string.", requestId });
    }
    if (message.length > 10_000) {
      return res.status(400).json({ error: "Message too long (max 10,000 chars).", requestId });
    }

    const lane = isLocalLifeQuery(message) ? "local" : "scholar";

    // Cache only for non-streaming
    const cacheKey = cache.keyFor({ model: OPENAI_MODEL, message, mode, lane });
    if (!stream) {
      const cached = cache.get(cacheKey);
      if (cached) {
        logger.info("Cache hit", { requestId, lane });
        return res.json({ text: cached, cached: true, requestId, lane });
      }
    }

    logger.info("Chat request", { requestId, mode, lane, stream, length: message.length });

    // Scholar lane policy + knowledge injection (if loaded)
    // Local lane policy without knowledge injection
    let systemText = "";

    if (lane === "local") {
      systemText = SYSTEM_POLICY_LOCAL.trim();
    } else {
      const kb = knowledge.getText();
      systemText =
        SYSTEM_POLICY_SCHOLAR.trim() +
        `\n\nMODE: ${mode}\n` +
        (kb ? `\nKNOWLEDGE (approved sources):\n${kb}\n` : `\nKNOWLEDGE: (not loaded)\n`);
    }

    // ---- Streaming (SSE) ----
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      let fullText = "";

      const streamResp = await client.responses.stream({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemText }] },
          { role: "user", content: [{ type: "input_text", text: message }] },
        ],
      });

      streamResp.on("response.output_text.delta", (event) => {
        const delta = event.delta || "";
        if (!delta) return;
        fullText += delta;
        res.write(`data: ${JSON.stringify({ delta, requestId, lane })}\n\n`);
      });

      streamResp.on("response.completed", () => {
        res.write(`data: ${JSON.stringify({ done: true, requestId, lane })}\n\n`);
        res.end();
        cache.set(cacheKey, fullText);
        logger.info("Stream complete", { requestId, lane, outLen: fullText.length });
      });

      streamResp.on("error", (e) => {
        const msg = e?.message || String(e);
        logger.error("Stream error", { requestId, lane, error: msg });
        try {
          res.write(`data: ${JSON.stringify({ error: "Stream error.", requestId, lane, done: true })}\n\n`);
          res.end();
        } catch {}
      });

      req.on("close", () => {
        try {
          streamResp.close();
        } catch {}
      });

      return;
    }

    // ---- Non-streaming ----
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        { role: "user", content: [{ type: "input_text", text: message }] },
      ],
    });

    const text = response.output_text || "I couldn't generate a response right now.";

    cache.set(cacheKey, text);

    return res.json({
      text,
      cached: false,
      requestId,
      lane,
      usage: response.usage,
    });
  } catch (err) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);

    logger.error("Error in /chat", { requestId, status, error: msg });

    if (status === 401) {
      return res.status(500).json({ error: "OpenAI authentication error.", requestId });
    }
    if (status === 429) {
      return res.status(429).json({ error: "OpenAI rate limit exceeded. Try again later.", requestId });
    }
    if (status === 400) {
      return res.status(500).json({ error: "OpenAI request was rejected (400). Check model/input formatting.", requestId });
    }

    return res.status(500).json({ error: "Server error.", requestId });
  }
});

// -----------------------------
// SPA fallback (Express 5-safe)
// -----------------------------
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -----------------------------
// Global error handler
// -----------------------------
app.use((err, req, res, _next) => {
  logger.error("Unhandled error", {
    requestId: req.requestId,
    error: err?.message || String(err),
    stack: err?.stack,
  });
  res.status(500).json({
    error: IS_PROD ? "Internal server error" : (err?.message || "Error"),
    requestId: req.requestId,
  });
});

// -----------------------------
// Start server + graceful shutdown
// -----------------------------
const server = app.listen(PORT, () => {
  logger.info(`OmanX running`, {
    url: `http://localhost:${PORT}`,
    env: NODE_ENV,
    model: OPENAI_MODEL,
  });
});

function shutdown(signal) {
  logger.info(`${signal} received. Shutting down...`);
  server.close(() => {
    logger.info("HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (e) => {
  logger.error("Uncaught exception", { error: e?.message || String(e), stack: e?.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: reason?.message || String(reason) });
});
