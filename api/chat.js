// api/chat.js - API route for OmanX chatbot

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KNOWLEDGE_PATHS = [
  path.join(process.cwd(), "data/knowledge.json"),
  path.join(__dirname, "../data/knowledge.json"),
  path.join(__dirname, "../../data/knowledge.json"),
];

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);

// Authoritative domains we trust for live policy lookups
const TRUSTED_DOMAINS = [
  "uscis.gov",
  "ice.gov",
  "dhs.gov",
  "studyinthestates.dhs.gov",
  "state.gov",
  "travel.state.gov",
  "studentaid.gov",
  "irs.gov",
  "dol.gov",
];

let _kb = null;
let _kbMtime = 0;
let _kbPath = null;

async function findKnowledgePath() {
  for (const testPath of KNOWLEDGE_PATHS) {
    try {
      await fs.access(testPath);
      return testPath;
    } catch {
      continue;
    }
  }
  return null;
}

async function getKB() {
  try {
    if (!_kbPath) _kbPath = await findKnowledgePath();
    if (!_kbPath) { console.warn("[OmanX] No knowledge base found"); return null; }
    const st = await fs.stat(_kbPath);
    if (_kb && st.mtimeMs <= _kbMtime) return _kb;
    const raw = await fs.readFile(_kbPath, "utf8");
    _kb = JSON.parse(raw);
    _kbMtime = st.mtimeMs;
    console.log(`[OmanX] Knowledge base loaded from ${_kbPath}`);
  } catch (error) {
    console.error("[OmanX] Error loading knowledge base:", error.message);
    _kb = null;
  }
  return _kb;
}

const COMPLIANCE_TRIGGERS = [
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

const BASE_SYSTEM = `You are OmanX, a warm and knowledgeable AI assistant built for Omani scholars studying in the United States. OmanX was founded by Mohammed Alkindi.

You handle two kinds of questions in one seamless conversation:

**Everyday questions** (food, campus life, activities, study tips, local recommendations, events, etc.)
Answer conversationally, warmly, and helpfully. Keep it natural and practical.

**Compliance questions** (visa, immigration, work authorization, OPT/CPT, legal matters, taxes, medical insurance, academic standing, government forms, DSO matters, contracts, housing disputes, etc.)
Use the knowledge base entries and live web search results provided below when available. Cite which KB entry or web source URL you're drawing from. Be precise and careful. Never speculate or invent contacts, deadlines, or procedures. If neither source covers the specific situation, say so clearly and direct the student to their DSO.

Always:
- Be honest when you don't know something — never guess on compliance matters
- For any compliance question, end your response with a clear reminder to verify with their Designated School Official (DSO) before taking action
- Never fabricate contact information, deadlines, or policy details`;

function buildSystemPrompt(kbResults, webResults, { conciseMode, userContext } = {}) {
  let prompt = BASE_SYSTEM;

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

  const { message, history, model: clientModel, conciseMode, userContext } = req.body || {};

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

  // Only cache non-compliance single-turn requests (compliance responses include live search data)
  const cacheKey = !hasHistory && !compliance
    ? crypto.createHash("sha256").update(`${model}::${useConcise}::${sanitizedUserContext}::${sanitizedMessage}`).digest("hex")
    : null;

  const cached = cacheKey ? cacheGet(cacheKey) : null;
  if (cached) return res.json({ text: cached, cached: true });

  // Run KB lookup and web search in parallel
  let kbResults = [];
  let webResults = [];
  if (compliance) {
    [kbResults, webResults] = await Promise.all([
      getKB().then((kb) => (kb ? searchKB(kb, sanitizedMessage) : [])),
      webSearch(sanitizedMessage),
    ]);
  }

  const systemPrompt = buildSystemPrompt(kbResults, webResults, { conciseMode: useConcise, userContext: sanitizedUserContext });

  try {
    console.log("[OmanX] /api/chat request", {
      model,
      compliance,
      webResults: webResults.length,
      kbResults: kbResults.length,
      conciseMode: useConcise,
      hasUserContext: !!sanitizedUserContext,
      chars: sanitizedMessage.length,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0.4,
      system: systemPrompt,
      messages: conversationMessages,
    });

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
