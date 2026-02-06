// server.js — OmanX MVP (Advanced, root-based, Express 5-safe)
// Goals:
// - Production-grade middleware (security, rate limit, logging, compression)
// - Root-directory static serving (index.html, styles.css, app.js all in root)
// - OpenAI Responses API (correct content types)
// - Optional SSE streaming
// - Knowledge.json hot-reload + caching
// - Strong error handling + graceful shutdown
// - UNIFIED MODE: Auto-routing between strict and normal lanes

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

import { routeQuery, searchKnowledge } from './router.js';
import { generateLocalResponse } from './localResponder.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
if (!OPENAI_API_KEY) {
  logger.warn("OPENAI_API_KEY is missing. Chat responses will use safe fallback guidance only.");
}

// In production, require ADMIN_KEY and ALLOWED_ORIGINS to be explicitly configured
if (IS_PROD) {
  if (!ADMIN_KEY) {
    logger.error("ADMIN_KEY is required in production. Set ADMIN_KEY in environment.");
    // Fail fast in production to avoid accidentally exposing admin endpoints.
    process.exit(1);
  }

  if (!ALLOWED_ORIGINS.length) {
    logger.error("ALLOWED_ORIGINS must be set in production to restrict CORS.");
    process.exit(1);
  }
}

// -----------------------------
// OpenAI client
// -----------------------------
const client = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
      timeout: 60_000,
      maxRetries: 2,
    })
  : null;

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
    try {
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
    } catch (e) {
      logger.error("Knowledge load failed", { error: e?.message || String(e) });
      // Don't crash - allow server to run without KB
      return false;
    }
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

  keyFor({ model, message, lane }) {
    return crypto
      .createHash("sha256")
      .update(`${model}::${lane || ""}::${message}`)
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
    // In production enable a reasonable CSP; disable only when developing locally.
    contentSecurityPolicy: IS_PROD
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "https:"] ,
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);

// CORS
app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin / curl / server-to-server requests
      if (!origin) return cb(null, true);

      // In production ALLOWED_ORIGINS is required (validated at startup).
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
    // In development we want request logs visible. Only skip morgan in production.
    skip: () => IS_PROD === true,
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

// Serve knowledge base entry (simple JSON) for frontend citations
app.get('/kb/:id', (req, res) => {
  try {
    const kb = knowledge.getJson();
    if (!kb) return res.status(503).json({ error: 'Knowledge base not available' });

    const id = req.params.id;
    let entry = null;

    if (Array.isArray(kb.documents)) {
      entry = kb.documents.find((d) => d.id === id);
    } else if (kb[id]) {
      entry = kb[id];
    }

    if (!entry) return res.status(404).json({ error: 'KB entry not found' });
    return res.json({ id, entry });
  } catch (e) {
    logger.error('KB fetch error', { error: e?.message || String(e) });
    return res.status(500).json({ error: 'KB lookup failed' });
  }
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

// Admin: upload new knowledge JSON (protected in production)
app.post('/admin/knowledge/upload', requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || (typeof payload !== 'object')) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON payload', requestId: req.requestId });
    }

    // Basic validation: must contain metadata and documents OR be object-based
    const hasDocs = Array.isArray(payload.documents) && payload.documents.length > 0;
    const hasObj = Object.keys(payload).length > 0 && (payload.metadata || hasDocs);
    if (!hasDocs && !hasObj) {
      return res.status(400).json({ ok: false, error: 'Knowledge JSON missing required fields', requestId: req.requestId });
    }

    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(payload, null, 2), 'utf8');
    await knowledge.load(true);
    return res.json({ ok: true, updated: true, requestId: req.requestId });
  } catch (e) {
    logger.error('KB upload failed', { error: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: 'KB upload failed', requestId: req.requestId });
  }
});

// -----------------------------
// Chat endpoint - UNIFIED MODE
// Body: { message: string, stream?: boolean }
// Auto-routes internally to strict or normal lane
// -----------------------------
app.post("/chat", apiLimiter, async (req, res) => {
  const requestId = req.requestId;

  try {
    const { message, stream = false } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Missing 'message' string.", requestId });
    }
    if (message.length > 10_000) {
      return res.status(400).json({ error: "Message too long (max 10,000 chars).", requestId });
    }

    // UNIFIED ROUTING: Auto-detect lane
    const routing = routeQuery(message);
    const lane = routing.lane; // 'strict' or 'normal'

    logger.info("Chat request (unified)", { 
      requestId, 
      lane, 
      stream, 
      length: message.length,
      triggers: routing.matches.slice(0, 3), // Log first 3 matches
      confidence: routing.confidence 
    });

    // Cache key includes routing decision
    const cacheKey = cache.keyFor({ model: OPENAI_MODEL, message, lane });
    if (!stream) {
      const cached = cache.get(cacheKey);
      if (cached) {
        logger.info("Cache hit", { requestId, lane });
        return res.json({ text: cached, cached: true, requestId, lane, kbRefs: [] });
      }
    }

    // Build system prompt based on lane
    let systemText = "";

    if (lane === 'normal') {
      // Normal lane: conversational, no KB needed
      systemText = SYSTEM_POLICY_LOCAL.trim();
    } else {
      // Strict lane: Load KB and search for relevant entries
      const kb = knowledge.getJson();
      
      if (!kb) {
        // KB not loaded → refuse + escalate
        const fallback = [
          "I cannot access the official knowledge base right now.",
          "For visa, immigration, work authorization, or compliance questions,",
          "please contact your Designated School Official (DSO) immediately.",
          "Do not rely on external sources for these matters.",
        ].join(" ");
        
        return res.json({
          text: fallback,
          cached: false,
          degraded: true,
          requestId,
          lane,
          kbRefs: [],
        });
      }
      
      // Search KB for relevant entries
      const kbResults = searchKnowledge(kb, message);
      const kbRefs = kbResults.slice(0, 3).map((r) => r.id);
      
      if (kbResults.length === 0) {
        // No relevant KB entries → refuse + escalate
        const noMatch = [
          "🔒 I couldn't find relevant official guidance for your question in my knowledge base.",
          "This may require case-specific advice.",
          "Please contact your Designated School Official (DSO) or your university's",
          "international student office for accurate information.",
          "Do not proceed without official confirmation.",
        ].join(" ");
        
        return res.json({
          text: noMatch,
          cached: false,
          noKbMatch: true,
          requestId,
          lane,
          kbRefs,
        });
      }
      
      // Build KB context from top 3 results
      const kbContext = kbResults.slice(0, 3).map((r, i) => {
        return `\n--- KB Entry ${i + 1}: ${r.id} (relevance: ${r.score}) ---\n` +
               JSON.stringify(r.doc, null, 2);
      }).join('\n');
      
      systemText = [
        SYSTEM_POLICY_SCHOLAR.trim(),
        "\n\n## RETRIEVED KNOWLEDGE BASE ENTRIES",
        "Use ONLY these entries to answer. Do not speculate beyond them.",
        "Paraphrase the guidance in user-friendly language.",
        "Cite which KB entry ID(s) you used.",
        kbContext,
      ].join('\n');
    }

    const buildFallbackText = (kbResults = []) =>
      generateLocalResponse({ lane, message, kbResults });

    if (!client) {
      const kbResults = lane === 'strict' ? searchKnowledge(knowledge.getJson(), message) : [];
      const kbRefs = kbResults.slice(0, 3).map((r) => r.id);
      return res.json({
        text: buildFallbackText(kbResults),
        cached: false,
        degraded: true,
        requestId,
        lane,
        kbRefs,
      });
    }

    // ---- Streaming (SSE) ----
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      let fullText = "";

      let streamResp;
      try {
        streamResp = await client.responses.stream({
          model: OPENAI_MODEL,
          input: [
            { role: "system", content: [{ type: "input_text", text: systemText }] },
            { role: "user", content: [{ type: "input_text", text: message }] },
          ],
        });
      } catch (e) {
        const msg = e?.message || String(e);
        logger.error("Stream init error", { requestId, lane, error: msg });
        res.write(
          `data: ${JSON.stringify({ error: buildFallbackText(), requestId, lane, done: true })}\n\n`
        );
        res.end();
        return;
      }

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
    let response;
    try {
      response = await client.responses.create({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemText }] },
          { role: "user", content: [{ type: "input_text", text: message }] },
        ],
      });
    } catch (e) {
      const msg = e?.message || String(e);
      const status = e?.status || e?.response?.status;
      logger.error("OpenAI request failed", { requestId, lane, status, error: msg });
      const kbResults = lane === 'strict' ? searchKnowledge(knowledge.getJson(), message) : [];
      const kbRefs = kbResults.slice(0, 3).map((r) => r.id);
      return res.json({
        text: buildFallbackText(kbResults),
        cached: false,
        degraded: true,
        requestId,
        lane,
        kbRefs,
      });
    }

    const text = response.output_text || "I couldn't generate a response right now.";
    cache.set(cacheKey, text);

    const kbRefs = lane === 'strict' ? searchKnowledge(knowledge.getJson(), message).slice(0, 3).map((r) => r.id) : [];
    return res.json({
      text,
      cached: false,
      requestId,
      lane,
      kbRefs,
      usage: response.usage,
    });
  } catch (err) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);

    logger.error("Error in /chat", { requestId, status, error: msg, stack: err?.stack });

    // Return user-safe error message, log full details server-side
    if (status === 401) {
      return res.status(500).json({ error: "Authentication error. Contact support.", requestId });
    }
    if (status === 429) {
      return res.status(429).json({ error: "Rate limit exceeded. Try again later.", requestId });
    }
    if (status === 400) {
      return res.status(500).json({ error: "Invalid request format. Contact support.", requestId });
    }

    return res.status(500).json({ error: "Server error. Please try again.", requestId });
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
  const userMessage = IS_PROD
    ? "Server error. Please try again later or contact support."
    : (err?.message || "Error") + (err?.stack ? `\n${err.stack}` : "");

  res.status(500).json({
    error: IS_PROD ? "Internal server error" : (err?.message || "Error"),
    text: userMessage,
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