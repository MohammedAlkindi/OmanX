// app.server.js — OmanX Unified Server

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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const CACHE_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);

const KNOWLEDGE_PATH = path.join(__dirname, "knowledge.json");
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// ============================================================================
// LOGGER
// ============================================================================
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

// ============================================================================
// ROUTING LOGIC
// ============================================================================
const STRICT_TRIGGERS = [
  'visa', 'f-1', 'f1', 'j-1', 'j1', 'i-20', 'i20', 'ds-2019', 'ds2019',
  'sevis', 'status', 'immigration', 'uscis', 'cbp', 'customs',
  'opt', 'cpt', 'stem', 'work authorization', 'employment', 'internship',
  'job', 'work permit', 'ead', 'off-campus', 'on-campus',
  'legal', 'law', 'lawsuit', 'police', 'arrest', 'violation',
  'deportation', 'removal', 'penalty', 'fine', 'compliance',
  'insurance', 'medical', 'health', 'hospital', 'doctor', 'emergency',
  'ambulance', 'prescription', 'treatment', 'covid', 'vaccination',
  'scholarship', 'funding', 'stipend', 'tax', 'irs', 'w-2', '1099',
  'ssn', 'social security', 'ministry', 'reimbursement', 'payment',
  'gpa', 'probation', 'dismissal', 'suspension', 'full-time',
  'course load', 'enrollment', 'registration', 'transcript',
  'dso', 'designated school official', 'oiss', 'international office',
  'form', 'application', 'petition', 'document', 'embassy', 'consulate',
  'deadline', 'expire', 'expiration', 'urgent', 'due date', 'asap',
  'lease', 'contract', 'rental agreement', 'eviction', 'landlord',
];

const NORMAL_SIGNALS = [
  'restaurant', 'food', 'eat', 'cafe', 'coffee', 'pizza', 'brunch',
  'gym', 'grocery', 'supermarket', 'laundry', 'shopping',
  'philly', 'philadelphia', 'things to do', 'recommend', 'nearby',
  'weekend', 'fun', 'entertainment', 'movie', 'park', 'museum',
];

function routeQuery(query) {
  if (!query || typeof query !== 'string') {
    return { lane: 'normal', matches: [], confidence: 0 };
  }

  const q = query.toLowerCase().trim();
  
  const strictMatches = STRICT_TRIGGERS.filter(trigger => 
    q.includes(trigger.toLowerCase())
  );
  
  if (strictMatches.length > 0) {
    return {
      lane: 'strict',
      matches: strictMatches,
      confidence: Math.min(strictMatches.length / 3, 1),
    };
  }
  
  const normalMatches = NORMAL_SIGNALS.filter(signal =>
    q.includes(signal.toLowerCase())
  );
  
  if (normalMatches.length > 0) {
    return {
      lane: 'normal',
      matches: normalMatches,
      confidence: Math.min(normalMatches.length / 2, 1),
    };
  }
  
  // Default: Ambiguous → strict (safety bias)
  return { lane: 'strict', matches: [], confidence: 0.3 };
}

function searchKnowledge(knowledgeJson, query) {
  if (!knowledgeJson || !query) return [];
  
  const q = query.toLowerCase();
  const results = [];
  
  if (Array.isArray(knowledgeJson.documents)) {
    for (const doc of knowledgeJson.documents) {
      if (!doc || !doc.id) continue;
      
      let score = 0;
      const docText = JSON.stringify(doc).toLowerCase();
      
      STRICT_TRIGGERS.forEach(trigger => {
        if (q.includes(trigger) && docText.includes(trigger)) {
          score += 2;
        }
      });
      
      if (doc.title && q.includes(doc.title.toLowerCase())) score += 5;
      if (doc.summary && q.includes(doc.summary.toLowerCase())) score += 3;
      
      if (score > 0) {
        results.push({ doc, score, id: doc.id });
      }
    }
  } else {
    for (const [key, content] of Object.entries(knowledgeJson)) {
      if (key === 'metadata') continue;
      
      let score = 0;
      const contentText = JSON.stringify(content).toLowerCase();
      
      STRICT_TRIGGERS.forEach(trigger => {
        if (q.includes(trigger) && contentText.includes(trigger)) {
          score += 2;
        }
      });
      
      if (score > 0) {
        results.push({ doc: content, score, id: key });
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================
const SYSTEM_POLICY_SCHOLAR = `
# OmanX Strict Compliance Mode

## IDENTITY & PURPOSE
You are OmanX in Strict Compliance Mode, providing official guidance for Omani scholars in the US on immigration, legal, medical, financial, and academic compliance matters.

## CORE PRINCIPLES
1. **Knowledge Base Primacy**: Use ONLY the provided knowledge base. Never extrapolate or speculate.
2. **Citation Requirement**: Every factual claim must reference specific KB sections.
3. **Clear Escalation**: Always provide exact contact details for human authorities.
4. **Safety First**: When uncertain, escalate to designated officials.

## RESPONSE TEMPLATE (MANDATORY)

🔒 **COMPLIANCE STATUS CHECK:**
[Brief assessment of regulatory context and urgency]

📋 **PRESCRIBED ACTION STEPS:**
1. [Step 1 from KB]
2. [Step 2 from KB]
3. [Step 3 from KB]

⚠️ **CRITICAL COMPLIANCE NOTES:**
- [Prohibitions/restrictions from KB]
- [Common violation scenarios from KB]

📚 **SOURCE VERIFICATION:**
Knowledge Base → [Document ID and section]
Last Updated: [Date from KB metadata]

🚨 **ESCALATION PATHWAYS:**
Primary: [DSO Name/Contact from KB]
Secondary: [Embassy contact from KB]
Emergency: [24/7 contact if available]

📝 **DOCUMENTATION REQUIREMENTS:**
- [Forms/evidence needed from KB]

⚠️ **VERIFICATION REMINDER:**
This guidance is based on official policies as of [date]. Always verify with your DSO before taking action.

## STRICT BOUNDARIES
- No legal interpretation beyond KB guidance
- No medical diagnosis or treatment recommendations
- No financial advice or speculation
- No creation of fictional contacts or procedures
- No extrapolation beyond explicitly stated information

## KNOWLEDGE GAP PROTOCOL
When KB lacks information:
1. Acknowledge: "This isn't covered in my current knowledge base."
2. Escalate: "Contact your DSO at [office from KB]"
3. Document: "Request this be added to OmanX KB via [process]"
`.trim();

const SYSTEM_POLICY_LOCAL = `
# OmanX Community Mode

## IDENTITY
You are OmanX Community Mode, the friendly assistant for daily life questions for Omani scholars in the US.

## SCOPE
✅ **Appropriate Topics:**
- Restaurant/food recommendations
- Social & cultural events
- Local exploration & activities
- Study tips (non-compliance)
- Daily living advice

❌ **Immediate Escalation Required:**
Any mention of: visa, immigration, work authorization, legal matters, medical/emergency, taxes, academic probation, official procedures, contracts, or government forms.

## RESPONSE STYLE
- Conversational and warm
- Experience-based: "Many scholars find..."
- 2-3 practical options
- Cultural sensitivity
- Always end with: "(Source: Community experience — verify for your situation)"

## ESCALATION RESPONSE
When strict topics appear:

"🔒 **Topic Safety Check:** This involves official regulations requiring precise guidance.

Please use OmanX Scholar Mode (Strict Compliance Mode) or contact your Designated School Official (DSO) for accurate information.

Switch to Scholar Mode, or I'm happy to help with other community questions! 😊"

## EMERGENCY PROTOCOL
For immediate danger/distress:
"🚨 **Emergency Protocol:** This requires immediate help.
Call 911 for emergencies or [campus emergency line]."
`.trim();

function buildKnowledgeText(knowledgeJson) {
  if (!knowledgeJson || typeof knowledgeJson !== "object") {
    return "# OmanX Knowledge Base\n\n*No knowledge base loaded.*";
  }

  const lines = ["# 🔐 OmanX Official Knowledge Base", ""];
  
  if (knowledgeJson.metadata) {
    lines.push("## 📋 Metadata");
    lines.push(`- Version: ${knowledgeJson.metadata.version || "Unversioned"}`);
    lines.push(`- Last Updated: ${knowledgeJson.metadata.lastUpdated || "Unknown"}`);
    lines.push(`- Authority: ${knowledgeJson.metadata.authority || "Advisory"}`);
    lines.push("");
  }

  if (Array.isArray(knowledgeJson.documents)) {
    for (const doc of knowledgeJson.documents) {
      if (!doc || !doc.id) continue;

      lines.push(`---\n\n## 📄 ${doc.title || doc.id}`);
      lines.push(`*Document ID: ${doc.id}*`);
      if (doc.effectiveDate) lines.push(`*Effective: ${doc.effectiveDate}*`);
      lines.push("");

      if (doc.summary) {
        lines.push("### Summary");
        lines.push(doc.summary);
        lines.push("");
      }

      if (Array.isArray(doc.procedures)) {
        lines.push("### Procedures");
        for (const proc of doc.procedures) {
          if (proc.title) lines.push(`#### ${proc.title}`);
          if (proc.description) lines.push(proc.description);
          if (Array.isArray(proc.steps)) {
            proc.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
          }
          lines.push("");
        }
      }

      if (Array.isArray(doc.rules)) {
        lines.push("### Rules");
        for (const rule of doc.rules) {
          if (rule.rule) lines.push(`#### ${rule.rule}`);
          if (rule.details) {
            if (Array.isArray(rule.details)) {
              rule.details.forEach(d => lines.push(`- ${d}`));
            } else {
              lines.push(rule.details);
            }
          }
          lines.push("");
        }
      }

      if (doc.contacts) {
        lines.push("### Contacts");
        Object.entries(doc.contacts).forEach(([role, contact]) => {
          lines.push(`**${role}:**`);
          if (contact.name) lines.push(`- Name: ${contact.name}`);
          if (contact.email) lines.push(`- Email: ${contact.email}`);
          if (contact.phone) lines.push(`- Phone: ${contact.phone}`);
          lines.push("");
        });
      }

      lines.push(`*End of Document: ${doc.id}*\n`);
    }
  } else {
    // Legacy format
    for (const [category, content] of Object.entries(knowledgeJson)) {
      if (category === "metadata") continue;
      lines.push(`## ${category}`);
      lines.push(typeof content === "string" ? content : JSON.stringify(content, null, 2));
      lines.push("");
    }
  }
  
  return lines.join("\n").trim();
}

// ============================================================================
// KNOWLEDGE MANAGER
// ============================================================================
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
        bytes: raw.length,
      });

      return true;
    } catch (e) {
      logger.error("Knowledge load failed", { error: e?.message || String(e) });
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

// ============================================================================
// RESPONSE CACHE
// ============================================================================
class ResponseCache {
  constructor({ ttlMs, maxEntries }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
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

// ============================================================================
// INITIALIZATION
// ============================================================================
if (!OPENAI_API_KEY) {
  logger.warn("OPENAI_API_KEY missing. Using fallback responses.");
}

const ADMIN_ENABLED = !IS_PROD || !!ADMIN_KEY;

if (IS_PROD && !ADMIN_KEY) {
  logger.error("ADMIN_KEY missing in production. Admin endpoints disabled.");
}

const client = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 60_000, maxRetries: 2 })
  : null;

const knowledge = new KnowledgeManager(KNOWLEDGE_PATH);
const cache = new ResponseCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

// ============================================================================
// EXPRESS APP
// ============================================================================
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Security
app.use(
  helmet({
    contentSecurityPolicy: IS_PROD
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "https:"],
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
      if (!origin) return cb(null, true);
      if (!ALLOWED_ORIGINS.length) return cb(null, true);

      try {
        const u = new URL(origin);
        const originHost = `${u.hostname}${u.port ? `:${u.port}` : ""}`;

        for (const allowedRaw of ALLOWED_ORIGINS) {
          const allowed = (allowedRaw || "").trim();
          if (!allowed) continue;

          if (allowed === origin) return cb(null, true);

          try {
            const a = new URL(allowed);
            const allowedHost = `${a.hostname}${a.port ? `:${a.port}` : ""}`;
            if (allowedHost === originHost) return cb(null, true);
            if (a.hostname === u.hostname) return cb(null, true);
            if ((a.hostname === "localhost" && u.hostname === "127.0.0.1") || 
                (a.hostname === "127.0.0.1" && u.hostname === "localhost")) {
              return cb(null, true);
            }
          } catch {
            if (allowed === originHost || allowed === u.hostname) return cb(null, true);
            if ((allowed === "localhost" && u.hostname === "127.0.0.1") || 
                (allowed === "127.0.0.1" && u.hostname === "localhost")) {
              return cb(null, true);
            }
          }
        }

        return cb(new Error(`CORS blocked: ${origin}`), false);
      } catch (e) {
        return cb(new Error(`CORS blocked: ${origin}`), false);
      }
    },
    credentials: true,
    methods: ["GET", "POST"],
  })
);

app.use(compression());
app.use(express.json({ limit: "1mb" }));

// Request IDs
app.use((req, res, next) => {
  const rid = req.headers["x-request-id"]?.toString() || crypto.randomBytes(8).toString("hex");
  req.requestId = rid;
  res.setHeader("X-Request-ID", rid);
  next();
});

// Logging
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: () => IS_PROD === true,
  })
);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
  handler: (req, res) => {
    logger.warn("Rate limit exceeded", { requestId: req.requestId, ip: req.ip });
    res.status(429).json({ error: "Too many requests. Try again later." });
  },
});

// API path normalization
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    req.url = req.url.replace(/^\/api/, "") || "/";
  }
  next();
});

// Static files
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

// ============================================================================
// STARTUP & RELOAD
// ============================================================================
try {
  await knowledge.load(true);
} catch (e) {
  logger.error("Failed to load knowledge.json at startup", { error: e?.message });
}

setInterval(async () => {
  try {
    await knowledge.load(false);
  } catch (e) {
    logger.error("Knowledge reload failed", { error: e?.message });
  }
}, Number(process.env.KNOWLEDGE_RELOAD_MS || 30_000));

// ============================================================================
// ROUTES
// ============================================================================

// Health
app.get("/health", async (req, res) => {
  try {
    let st = null;
    try {
      st = await fs.stat(KNOWLEDGE_PATH);
    } catch {}

    res.json({
      ok: true,
      env: NODE_ENV,
      uptime_s: Math.round(process.uptime()),
      requestId: req.requestId,
      openai: { configured: !!OPENAI_API_KEY, model: OPENAI_MODEL },
      knowledge: { loaded: !!knowledge.getJson(), mtimeMs: st?.mtimeMs ?? null },
      cache: cache.stats(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message, requestId: req.requestId });
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

// Knowledge base entry
app.get('/kb/:id', (req, res) => {
  try {
    const kb = knowledge.getJson();
    if (!kb) return res.status(503).json({ error: 'Knowledge base unavailable' });

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
    logger.error('KB fetch error', { error: e?.message });
    return res.status(500).json({ error: 'KB lookup failed' });
  }
});

// Admin middleware
function requireAdmin(req, res, next) {
  if (!ADMIN_ENABLED) {
    return res.status(503).json({ error: "Admin endpoints disabled", requestId: req.requestId });
  }
  if (!IS_PROD) return next();
  const key = (req.headers["x-admin-key"] || req.body?.adminKey || "").toString();
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized", requestId: req.requestId });
  }
  next();
}

// Admin endpoints
app.post("/admin/cache/clear", requireAdmin, (req, res) => {
  cache.clear();
  res.json({ ok: true, requestId: req.requestId });
});

app.post("/admin/knowledge/reload", requireAdmin, async (req, res) => {
  try {
    const updated = await knowledge.load(true);
    res.json({ ok: true, updated, requestId: req.requestId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message, requestId: req.requestId });
  }
});

app.post('/admin/knowledge/upload', requireAdmin, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid JSON', requestId: req.requestId });
    }

    const hasDocs = Array.isArray(payload.documents) && payload.documents.length > 0;
    const hasObj = Object.keys(payload).length > 0 && (payload.metadata || hasDocs);
    if (!hasDocs && !hasObj) {
      return res.status(400).json({ ok: false, error: 'Invalid KB structure', requestId: req.requestId });
    }

    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(payload, null, 2), 'utf8');
    await knowledge.load(true);
    return res.json({ ok: true, updated: true, requestId: req.requestId });
  } catch (e) {
    logger.error('KB upload failed', { error: e?.message });
    return res.status(500).json({ ok: false, error: 'KB upload failed', requestId: req.requestId });
  }
});

// ============================================================================
// CHAT ENDPOINT
// ============================================================================
app.post("/chat", apiLimiter, async (req, res) => {
  const requestId = req.requestId;

  try {
    const { message, stream = false, mode: clientMode } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Missing 'message' string.", requestId });
    }
    if (message.length > 10_000) {
      return res.status(400).json({ error: "Message too long (max 10,000 chars).", requestId });
    }

    // Auto-route
    const routing = routeQuery(message);
    let lane = routing.lane;
    if (clientMode === 'community' || clientMode === 'local') lane = 'normal';
    if (clientMode === 'official' || clientMode === 'strict') lane = 'strict';

    logger.info("Chat request", { 
      requestId, 
      clientMode: clientMode || null,
      lane, 
      stream,
      triggers: routing.matches.slice(0, 3),
    });

    // Cache check
    const cacheKey = cache.keyFor({ model: OPENAI_MODEL, message, lane });
    if (!stream) {
      const cached = cache.get(cacheKey);
      if (cached) {
        logger.info("Cache hit", { requestId, lane });
        return res.json({ text: cached, cached: true, requestId, lane, kbRefs: [] });
      }
    }

    // Build system prompt
    let systemText = "";

    if (lane === 'normal') {
      systemText = SYSTEM_POLICY_LOCAL.trim();
    } else {
      const kb = knowledge.getJson();
      
      if (!kb) {
        const fallback = [
          "I cannot access the official knowledge base right now.",
          "For visa, immigration, or compliance questions,",
          "contact your Designated School Official (DSO) immediately.",
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
      
      const kbResults = searchKnowledge(kb, message);
      const kbRefs = kbResults.slice(0, 3).map((r) => r.id);
      
      if (kbResults.length === 0) {
        const noMatch = [
          "🔒 I couldn't find relevant guidance in my knowledge base.",
          "This may require case-specific advice.",
          "Please contact your Designated School Official (DSO) for accurate information.",
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
      
      const kbContext = kbResults.slice(0, 3).map((r, i) => {
        return `\n--- KB Entry ${i + 1}: ${r.id} (relevance: ${r.score}) ---\n` +
               JSON.stringify(r.doc, null, 2);
      }).join('\n');
      
      systemText = [
        SYSTEM_POLICY_SCHOLAR.trim(),
        "\n\n## RETRIEVED KNOWLEDGE BASE ENTRIES",
        "Use ONLY these entries. Cite KB entry IDs used.",
        kbContext,
      ].join('\n');
    }

    const buildFallback = () => [
      lane === 'strict'
        ? "For compliance matters, contact your DSO directly."
        : "General advice unavailable. Try rephrasing your question.",
    ].join(" ");

    if (!client) {
      const kbRefs = lane === 'strict' ? searchKnowledge(knowledge.getJson(), message).slice(0, 3).map(r => r.id) : [];
      return res.json({
        text: buildFallback(),
        cached: false,
        degraded: true,
        requestId,
        lane,
        kbRefs,
      });
    }

    // Streaming
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
        logger.error("Stream init error", { requestId, lane, error: e?.message });
        res.write(`data: ${JSON.stringify({ error: buildFallback(), done: true })}\n\n`);
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
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        cache.set(cacheKey, fullText);
        logger.info("Stream complete", { requestId, lane, outLen: fullText.length });
      });

      streamResp.on("error", (e) => {
        logger.error("Stream error", { requestId, lane, error: e?.message });
        try {
          res.write(`data: ${JSON.stringify({ error: "Stream error.", done: true })}\n\n`);
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

    // Non-streaming
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
      logger.error("OpenAI request failed", { requestId, lane, error: e?.message });
      const kbRefs = lane === 'strict' ? searchKnowledge(knowledge.getJson(), message).slice(0, 3).map(r => r.id) : [];
      return res.json({
        text: buildFallback(),
        cached: false,
        degraded: true,
        requestId,
        lane,
        kbRefs,
      });
    }

    const text = response.output_text || "No response generated.";
    cache.set(cacheKey, text);

    const kbRefs = lane === 'strict' ? searchKnowledge(knowledge.getJson(), message).slice(0, 3).map(r => r.id) : [];
    return res.json({
      text,
      cached: false,
      requestId,
      lane,
      kbRefs,
      usage: response.usage,
    });
  } catch (err) {
    logger.error("Error in /chat", { requestId, error: err?.message, stack: err?.stack });

    if (err?.status === 401) {
      return res.status(500).json({ error: "Authentication error.", requestId });
    }
    if (err?.status === 429) {
      return res.status(429).json({ error: "Rate limit exceeded.", requestId });
    }

    return res.status(500).json({ error: "Server error. Try again.", requestId });
  }
});

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error("Unhandled error", {
    requestId: req.requestId,
    error: err?.message,
    stack: err?.stack,
  });
  
  res.status(500).json({
    error: IS_PROD ? "Internal server error" : err?.message,
    requestId: req.requestId,
  });
});

export default app;