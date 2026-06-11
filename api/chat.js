// api/chat.js - API route for OmanX chatbot

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MOHE_PATHS = [
  path.join(process.cwd(), "data/mohe.json"),
  path.join(__dirname, "../data/mohe.json"),
  path.join(__dirname, "../../data/mohe.json"),
];

const DEST_KB_PATHS = {
  us: [
    path.join(process.cwd(), "data/us.json"),
    path.join(__dirname, "../data/us.json"),
    path.join(__dirname, "../../data/us.json"),
  ],
  uk: [
    path.join(process.cwd(), "data/uk.json"),
    path.join(__dirname, "../data/uk.json"),
    path.join(__dirname, "../../data/uk.json"),
  ],
  au: [
    path.join(process.cwd(), "data/au.json"),
    path.join(__dirname, "../data/au.json"),
    path.join(__dirname, "../../data/au.json"),
  ],
};

// Legacy fallback if destination files don't exist
const KNOWLEDGE_PATHS = [
  path.join(process.cwd(), "data/knowledge.json"),
  path.join(__dirname, "../data/knowledge.json"),
  path.join(__dirname, "../../data/knowledge.json"),
];

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);

// Authoritative domains we trust for live policy lookups
const TRUSTED_DOMAINS = [
  // US
  "uscis.gov", "ice.gov", "dhs.gov", "studyinthestates.dhs.gov",
  "state.gov", "travel.state.gov", "studentaid.gov", "irs.gov", "dol.gov",
  // UK
  "gov.uk", "ukcisa.org.uk",
  // AU
  "homeaffairs.gov.au", "immi.homeaffairs.gov.au", "studyaustralia.gov.au",
  "teqsa.gov.au", "asqa.gov.au", "oso.gov.au",
];

const _destCache = {}; // { us: {kb, mtime, path}, uk: {...}, au: {...} }
const _moheCache = { kb: null, mtime: 0, path: null };
let _legacyKbPath = null;
let _legacyKb = null;
let _legacyKbMtime = 0;

async function findPath(paths) {
  for (const p of paths) {
    try { await fs.access(p); return p; } catch { /* continue */ }
  }
  return null;
}

async function getMoheKb() {
  try {
    if (!_moheCache.path) _moheCache.path = await findPath(MOHE_PATHS);
    if (!_moheCache.path) return null;
    const st = await fs.stat(_moheCache.path);
    if (_moheCache.kb && st.mtimeMs <= _moheCache.mtime) return _moheCache.kb;
    _moheCache.kb = JSON.parse(await fs.readFile(_moheCache.path, "utf8"));
    _moheCache.mtime = st.mtimeMs;
  } catch (e) {
    console.error("[OmanX] Error loading MoHE KB:", e.message);
    _moheCache.kb = null;
  }
  return _moheCache.kb;
}

function detectDestination(userContext, message) {
  const text = `${userContext || ""} ${message || ""}`.toLowerCase();
  if (
    text.includes("united kingdom") || text.includes(" uk ") || text.includes("uk,") ||
    text.includes("britain") || text.includes("england") || text.includes("scotland") ||
    text.includes("wales") || text.includes("student route") || text.includes("ukvi") ||
    text.includes("graduate route") || text.includes("tier 4") || text.includes("ukcisa") ||
    text.includes("atas certificate") || text.includes("british")
  ) return "uk";
  if (
    text.includes("australia") || text.includes("subclass 500") || text.includes("subclass 485") ||
    text.includes("oshc") || text.includes("cricos") || text.includes(" esos") ||
    text.includes("homeaffairs") || text.includes("genuine student") ||
    text.includes("temporary graduate")
  ) return "au";
  return "us";
}

async function getKB(destination = "us") {
  try {
    const paths = DEST_KB_PATHS[destination] || DEST_KB_PATHS.us;
    const cache = _destCache[destination] || (_destCache[destination] = { kb: null, mtime: 0, path: null });

    if (!cache.path) cache.path = await findPath(paths);

    // Fall back to legacy knowledge.json if destination file not found
    if (!cache.path) {
      if (!_legacyKbPath) _legacyKbPath = await findPath(KNOWLEDGE_PATHS);
      if (!_legacyKbPath) { console.warn("[OmanX] No knowledge base found"); return null; }
      const st = await fs.stat(_legacyKbPath);
      if (_legacyKb && st.mtimeMs <= _legacyKbMtime) return _legacyKb;
      _legacyKb = JSON.parse(await fs.readFile(_legacyKbPath, "utf8"));
      _legacyKbMtime = st.mtimeMs;
      console.log(`[OmanX] Falling back to legacy KB: ${_legacyKbPath}`);
      return _legacyKb;
    }

    const [st, moheKb] = await Promise.all([fs.stat(cache.path), getMoheKb()]);
    if (!cache.kb || st.mtimeMs > cache.mtime) {
      cache.kb = JSON.parse(await fs.readFile(cache.path, "utf8"));
      cache.mtime = st.mtimeMs;
      console.log(`[OmanX] Knowledge base loaded: ${destination} (${cache.path})`);
    }

    // Compose: destination docs + shared MoHE docs
    if (moheKb?.documents?.length) {
      return {
        ...cache.kb,
        documents: [...(cache.kb.documents || []), ...(moheKb.documents || [])],
      };
    }
    return cache.kb;
  } catch (error) {
    console.error("[OmanX] Error loading knowledge base:", error.message);
    return null;
  }
}

const COMPLIANCE_TRIGGERS = [
  // US immigration
  "visa", "f-1", "f1", "j-1", "j1", "i-20", "i20", "ds-2019", "ds2019",
  "sevis", "immigration", "uscis", "cbp", "customs",
  "opt", "cpt", "stem", "work authorization", "employment", "internship",
  "job", "work permit", "ead", "off-campus", "on-campus",
  "legal", "law", "lawsuit", "police", "arrest", "violation",
  "deportation", "removal", "penalty", "compliance",
  "insurance", "medical", "health", "hospital", "doctor", "emergency",
  "ambulance", "prescription", "treatment", "covid", "vaccination",
  "scholarship", "funding", "stipend", "tax", "irs", "w-2", "1099",
  "ssn", "social security", "ministry", "reimbursement",
  "gpa", "probation", "dismissal", "suspension", "full-time",
  "course load", "enrollment", "registration", "transcript",
  "dso", "designated school official", "oiss", "international office",
  "form", "application", "petition", "document", "embassy", "consulate",
  "deadline", "expire", "expiration", "lease", "contract",
  "rental agreement", "eviction", "landlord",
  // UK-specific
  "student route", "tier 4", "ukvi", "cas ", "graduate route", "brp", "evisa",
  "atas", "ukcisa", "leave to remain", "curtailed", "ihs", "nhs surcharge",
  "immigration health surcharge", "skilled worker", "police registration",
  // AU-specific
  "subclass 500", "subclass 485", "oshc", "cricos", "esos", "coe ", "home affairs",
  "genuine student", "temporary graduate", "teqsa", "asqa", "fortnight",
];

function isCompliance(message) {
  if (!message) return false;
  const q = message.toLowerCase();
  return COMPLIANCE_TRIGGERS.some((t) => q.includes(t));
}

function searchKB(knowledgeJson, query) {
  if (!knowledgeJson) return [];
  const q = query.toLowerCase();
  const results = [];
  const docs = Array.isArray(knowledgeJson.documents)
    ? knowledgeJson.documents
    : Object.entries(knowledgeJson)
        .filter(([k]) => k !== "metadata")
        .map(([k, v]) => ({
          id: k,
          ...(typeof v === "object" && v !== null ? v : { content: v }),
        }));
  for (const doc of docs) {
    if (!doc) continue;
    const text = JSON.stringify(doc).toLowerCase();
    const score = COMPLIANCE_TRIGGERS.filter(
      (t) => q.includes(t) && text.includes(t)
    ).length;
    if (score > 0) results.push({ doc, score, id: doc.id || "unknown" });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

async function webSearch(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        include_answer: false,
        include_domains: TRUSTED_DOMAINS,
        max_results: 3,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn("[OmanX] Tavily search failed:", res.status);
      return [];
    }

    const data = await res.json();
    return (data.results || []).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      content: (r.content || "").slice(0, 600),
    }));
  } catch (err) {
    console.warn("[OmanX] Web search error:", err.message);
    return [];
  }
}

const BASE_SYSTEM = `You are OmanX, a warm and knowledgeable AI assistant built for Omani scholars studying abroad — in the United States, United Kingdom, or Australia. OmanX was founded by Mohammed Alkindi.

You handle two kinds of questions in one seamless conversation:

**Everyday questions** (food, campus life, activities, study tips, local recommendations, events, etc.)
Answer conversationally, warmly, and helpfully. Keep it natural and practical.

**Compliance questions** (visa, immigration, work authorization, OPT/CPT, legal matters, taxes, medical insurance, academic standing, government forms, DSO matters, contracts, housing disputes, etc.)
Use the knowledge base entries and live web search results provided below when available. Cite which KB entry or web source URL you're drawing from. Be precise and careful. Never speculate or invent contacts, deadlines, or procedures. If neither source covers the specific situation, say so clearly and direct the student to their DSO.

Always:
- Be honest when you don't know something — never guess on compliance matters
- For any compliance question, end your response with a clear reminder to verify with their Designated School Official (DSO) before taking action
- Never fabricate contact information, deadlines, or policy details`;

function buildSystemPrompt(kbResults, webResults, { conciseMode, userContext, language } = {}) {
  let prompt = BASE_SYSTEM;

  if (language) {
    prompt += `\n\n---\n\nLanguage: Always respond in ${language}, regardless of what language the student writes in.`;
  }

  if (userContext) {
    prompt += `\n\n---\n\n## Student Context\nThe student has provided the following context about themselves. Use it to personalize your guidance:\n${userContext}`;
  }

  if (conciseMode) {
    prompt += "\n\n---\n\nResponse style: Keep answers concise and to the point. Use bullet points over prose where appropriate. Avoid lengthy preamble.";
  }

  if (kbResults && kbResults.length > 0) {
    const kbSection = kbResults
      .map((r, i) => `### KB Entry ${i + 1} — ID: ${r.id}\n${JSON.stringify(r.doc, null, 2)}`)
      .join("\n\n");
    prompt += `\n\n---\n\n## Relevant Knowledge Base Entries\nUse these entries for compliance guidance. Cite the entry ID when referencing them.\n\n${kbSection}`;
  }

  if (webResults && webResults.length > 0) {
    const webSection = webResults
      .map((r, i) => `### Web Result ${i + 1} — ${r.url}\n**${r.title}**\n${r.content}`)
      .join("\n\n");
    prompt += `\n\n---\n\n## Live Web Search Results (official government sources)\nThese results were retrieved in real time. Cite the URL when referencing them. Prioritize these over the knowledge base for current deadlines and policy changes.\n\n${webSection}`;
  }

  return prompt;
}

const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value) {
  if (_cache.size > 500) _cache.delete(_cache.keys().next().value);
  _cache.set(key, { ts: Date.now(), value });
}

// Per-IP rate limiting: 20 requests per 60-second window
const _rateLimitMap = new Map();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = _rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitMap.set(ip, { count: 1, windowStart: now });
    if (_rateLimitMap.size > 5000) {
      for (const [key, val] of _rateLimitMap) {
        if (now - val.windowStart > RATE_LIMIT_WINDOW_MS) _rateLimitMap.delete(key);
      }
    }
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[OmanX] Missing ANTHROPIC_API_KEY environment variable");
    return null;
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 });
  return _client;
}

function sanitizeMessage(message) {
  return message.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const requestOrigin = req.headers.origin;
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please slow down.", text: "You've sent too many messages too quickly. Please wait a moment before trying again." });
  }

  const { message, history, model: clientModel, conciseMode, userContext, language, webSearch: clientWebSearch } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string." });
  }

  const sanitizedMessage = sanitizeMessage(message);

  if (sanitizedMessage.length === 0) {
    return res.status(400).json({ error: "Message is empty after sanitization." });
  }

  if (sanitizedMessage.length > 10_000) {
    return res.status(400).json({ error: "Message too long (max 10,000 chars)." });
  }

  const model = ALLOWED_MODELS.has(clientModel) ? clientModel : DEFAULT_MODEL;
  const sanitizedUserContext = userContext ? sanitizeMessage(String(userContext)).slice(0, 2000) : "";
  const useConcise = conciseMode === true;
  const responseLanguage = (typeof language === 'string' && language !== 'auto') ? language : null;

  const hasHistory = Array.isArray(history) && history.length > 0;
  const conversationMessages = [];
  if (hasHistory) {
    for (const turn of history.slice(-20)) {
      if (turn.role !== "user" && turn.role !== "assistant") continue;
      const sanitized = sanitizeMessage(String(turn.content || ""));
      if (sanitized) conversationMessages.push({ role: turn.role, content: sanitized });
    }
  }
  conversationMessages.push({ role: "user", content: sanitizedMessage });

  const client = getClient();
  if (!client) {
    return res.status(500).json({
      text: "OmanX is not configured. Please contact the administrator.",
      error: "Anthropic client not configured",
    });
  }

  const compliance = isCompliance(sanitizedMessage);
  const destination = detectDestination(sanitizedUserContext, sanitizedMessage);

  // Only cache non-compliance single-turn requests (compliance responses include live search data)
  const cacheKey = !hasHistory && !compliance
    ? crypto.createHash("sha256").update(`${model}::${useConcise}::${sanitizedUserContext}::${sanitizedMessage}`).digest("hex")
    : null;

  const wantsStream = req.body?.stream === true;

  const cached = cacheKey ? cacheGet(cacheKey) : null;
  if (cached) {
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ t: cached })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, compliance: false, webSearched: false })}\n\n`);
      return res.end();
    }
    return res.json({ text: cached, cached: true });
  }

  // Run KB lookup and web search in parallel
  let kbResults = [];
  let webResults = [];
  const allowWebSearch = clientWebSearch !== false;
  if (compliance) {
    [kbResults, webResults] = await Promise.all([
      getKB(destination).then((kb) => (kb ? searchKB(kb, sanitizedMessage) : [])),
      allowWebSearch ? webSearch(sanitizedMessage) : Promise.resolve([]),
    ]);
  }

  const systemPrompt = buildSystemPrompt(kbResults, webResults, { conciseMode: useConcise, userContext: sanitizedUserContext, language: responseLanguage });

  const requestParams = {
    model,
    max_tokens: 2048,
    temperature: 0.4,
    system: systemPrompt,
    messages: conversationMessages,
  };

  console.log("[OmanX] /api/chat request", {
    model,
    compliance,
    destination,
    stream: wantsStream,
    webResults: webResults.length,
    kbResults: kbResults.length,
    conciseMode: useConcise,
    hasUserContext: !!sanitizedUserContext,
    chars: sanitizedMessage.length,
  });

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullText = '';
    try {
      const stream = client.messages.stream(requestParams);
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text;
          res.write(`data: ${JSON.stringify({ t: event.delta.text })}\n\n`);
        }
      }
      if (cacheKey) cacheSet(cacheKey, fullText.trim());
      res.write(`data: ${JSON.stringify({ done: true, compliance, webSearched: webResults.length > 0 })}\n\n`);
      res.end();
    } catch (err) {
      console.error("[OmanX] Anthropic stream error:", err?.message);
      const errMsg = err?.status === 429
        ? "I'm experiencing high demand. Please try again in a moment."
        : compliance
          ? "I couldn't process your request. For compliance matters, contact your DSO directly."
          : "I couldn't process your request. Please try again.";
      res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
      res.end();
    }
    return;
  }

  try {
    const response = await client.messages.create(requestParams);
    const text = response.content?.[0]?.text?.trim() || "No response generated.";
    if (cacheKey) cacheSet(cacheKey, text);
    return res.json({ text, cached: false, compliance, webSearched: webResults.length > 0 });
  } catch (err) {
    console.error("[OmanX] Anthropic error:", err?.message, err?.stack);
    if (err?.status === 429) {
      return res.status(429).json({
        error: "Rate limit reached. Please wait a moment and try again.",
        text: "I'm experiencing high demand. Please try again in a moment.",
      });
    }
    if (err?.status === 401) {
      return res.status(500).json({
        error: "Authentication error. Please contact the administrator.",
        text: "I'm having trouble connecting. Please try again later.",
      });
    }
    return res.status(500).json({
      text: compliance
        ? "I couldn't process your request. For compliance matters, contact your DSO directly."
        : "I couldn't process your request. Please try again.",
      error: err?.message || "Unknown error",
    });
  }
}
