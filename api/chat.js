// api/chat.js — OmanX Complete Chat Handler (self-contained)

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_PATH = path.join(__dirname, "../data/knowledge.json");
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ── Knowledge base (file-cached, reloads if modified) ────────────────────────
let _kb = null;
let _kbMtime = 0;

async function getKB() {
  try {
    const st = await fs.stat(KNOWLEDGE_PATH);
    if (_kb && st.mtimeMs <= _kbMtime) return _kb;
    const raw = await fs.readFile(KNOWLEDGE_PATH, "utf8");
    _kb = JSON.parse(raw);
    _kbMtime = st.mtimeMs;
  } catch {
    _kb = null;
  }
  return _kb;
}

// ── Compliance topic detection ────────────────────────────────────────────────
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
  const q = message.toLowerCase();
  return COMPLIANCE_TRIGGERS.some((t) => q.includes(t));
}

// ── KB search ─────────────────────────────────────────────────────────────────
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

// ── System prompt ─────────────────────────────────────────────────────────────
const BASE_SYSTEM = `You are OmanX, a warm and knowledgeable AI assistant built for Omani scholars studying in the United States.

You handle two kinds of questions in one seamless conversation:

**Everyday questions** (food, campus life, activities, study tips, local recommendations, events, etc.)
Answer conversationally, warmly, and helpfully. Keep it natural and practical.

**Compliance questions** (visa, immigration, work authorization, OPT/CPT, legal matters, taxes, medical insurance, academic standing, government forms, DSO matters, contracts, housing disputes, etc.)
Use the knowledge base entries provided below when available. Cite which KB entry you're drawing from. Be precise and careful. Never speculate or invent contacts, deadlines, or procedures. If the KB doesn't cover the specific situation, say so clearly and direct the student to their DSO.

Always:
- Be honest when you don't know something — never guess on compliance matters
- For any compliance question, end your response with a clear reminder to verify with their Designated School Official (DSO) before taking action
- Never fabricate contact information, deadlines, or policy details`;

function buildSystemPrompt(kbResults) {
  if (!kbResults || kbResults.length === 0) return BASE_SYSTEM;

  const kbSection = kbResults
    .map(
      (r, i) =>
        `### KB Entry ${i + 1} — ID: ${r.id}\n${JSON.stringify(r.doc, null, 2)}`
    )
    .join("\n\n");

  return `${BASE_SYSTEM}

---

## Relevant Knowledge Base Entries
Use ONLY these entries for compliance guidance. Cite the entry ID when referencing them.

${kbSection}`;
}

// ── Response cache (in-memory, TTL 10 min) ────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (_cache.size > 500) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(key, { ts: Date.now(), value });
}

// ── OpenAI client (lazy singleton) ───────────────────────────────────────────
let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) return null;
  _client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60_000,
    maxRetries: 2,
  });
  return _client;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string." });
  }
  if (message.length > 10_000) {
    return res.status(400).json({ error: "Message too long (max 10,000 chars)." });
  }

  const client = getClient();
  if (!client) {
    return res.status(500).json({
      text: "OmanX is not configured. Please contact the administrator.",
    });
  }

  // Cache lookup
  const cacheKey = crypto
    .createHash("sha256")
    .update(`${MODEL}::${message}`)
    .digest("hex");

  const cached = cacheGet(cacheKey);
  if (cached) {
    return res.json({ text: cached, cached: true });
  }

  // Detect topic and load KB if compliance-related
  const compliance = isCompliance(message);
  let kbResults = [];

  if (compliance) {
    const kb = await getKB();
    if (kb) {
      kbResults = searchKB(kb, message);
    }
  }

  const systemPrompt = buildSystemPrompt(kbResults);

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      max_tokens: 1024,
      temperature: 0.4,
    });

    const text =
      response.choices?.[0]?.message?.content?.trim() ||
      "No response generated.";

    cacheSet(cacheKey, text);
    return res.json({ text, cached: false, compliance });
  } catch (err) {
    console.error("[OmanX] OpenAI error:", err?.message);

    if (err?.status === 429) {
      return res.status(429).json({
        error: "Rate limit reached. Please wait a moment and try again.",
      });
    }
    if (err?.status === 401) {
      return res.status(500).json({
        error: "Authentication error. Please contact the administrator.",
      });
    }

    return res.status(500).json({
      text: compliance
        ? "I couldn't process your request. For compliance matters, contact your DSO directly."
        : "I couldn't process your request. Please try again.",
    });
  }
}