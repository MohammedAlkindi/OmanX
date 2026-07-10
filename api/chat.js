// api/chat.js - API route for OmanX chatbot

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { consumeUsage, getRateLimitKey, getRequestSessionId } from "./rate-limit.js";
import { getAuthUser } from "./auth-utils.js";

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


const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);
const VALID_DESTINATIONS = new Set(["us", "uk", "au"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_ATTACHMENTS = Number(process.env.IMAGE_UPLOAD_MAX_COUNT || 1);
const MAX_IMAGE_BYTES = Number(process.env.IMAGE_UPLOAD_MAX_BYTES || 3 * 1024 * 1024);

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
    if (!cache.path) { console.warn("[OmanX] No knowledge base found for destination:", destination); return null; }

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

const URGENCY_TRIGGERS = [
  // time pressure
  "expires", "expiring", "expired", "expiration", "expiry",
  "overdue", "deadline", "due date",
  "tomorrow", "today", "right now", "immediately",
  "next week", "this week", "in a few days",
  "running out of time", "out of status",
  // violations / serious events
  "violated", "violation", "violating", "in violation",
  "arrested", "arrest", "detained", "detention",
  "deported", "deportation", "removal", "removed",
  "dismissed", "dismissal", "suspended", "suspension", "expelled", "expulsion",
  "reinstatement", "reinstate",
  "sevis terminated", "sevis termination",
  "unlawful presence", "grace period",
  "lost my status", "lose my status",
  "overstayed", "overstay",
  // medical
  "emergency", "ambulance", "hospitalized",
  // housing
  "eviction", "evicted",
  // academic
  "academic probation", "probation",
  // financial
  "scholarship cancelled", "lost funding", "funding cut", "funding terminated",
  // legal
  "lawsuit", "sued", "court hearing",
];

function isUrgent(message) {
  if (!message) return false;
  const q = message.toLowerCase();
  return URGENCY_TRIGGERS.some((t) => q.includes(t));
}

const ESCALATION_DSO = {
  us: "Contact your university's International Student Services Office (ISSO) as soon as possible. Search \"[your university] international student office\" to find their emergency line and email.",
  uk: "Contact your university's International Student Advisory Service and your Student Route sponsor immediately.",
  au: "Contact your university's International Student Support Office immediately. For visa matters, also contact the Department of Home Affairs.",
};

const ESCALATION_EMBASSIES = {
  us: { name: "Omani Embassy — Washington D.C.", note: "For emergencies (arrest, hospitalization, lost passport), contact the Cultural Attaché or Consular Section directly." },
  uk: { name: "Omani Embassy — London", note: "For emergencies, contact the Omani Embassy Consular Section." },
  au: { name: "Omani Embassy — Canberra", note: "For emergencies, contact the Omani Embassy for consular assistance." },
};

function buildEscalationCard(message, destination) {
  const q = message.toLowerCase();
  const dest = destination || "us";
  const card = {
    level: "urgent",
    title: "",
    steps: [],
    dsoNote: ESCALATION_DSO[dest] || ESCALATION_DSO.us,
    embassy: null,
    forms: [],
  };

  if (q.includes("arrest") || q.includes("detained") || q.includes("court hearing") || q.includes("lawsuit") || q.includes("sued")) {
    card.title = "Legal emergency — act now";
    card.steps = [
      "Do not make statements to authorities without legal representation.",
      "Contact your university's International Student Services Office immediately.",
      "Contact the Omani Embassy or Consulate in your country.",
      "Do not travel internationally until your situation is resolved.",
    ];
    card.embassy = ESCALATION_EMBASSIES[dest] || ESCALATION_EMBASSIES.us;

  } else if (q.includes("sevis terminated") || q.includes("sevis termination") || q.includes("out of status") || q.includes("unlawful presence") || q.includes("overstay") || (q.includes("violated") && (q.includes("visa") || q.includes("status") || q.includes("sevis"))) || q.includes("in violation")) {
    card.title = "Status violation — contact DSO today";
    card.steps = [
      "Contact your DSO immediately — do not wait.",
      "Do not leave the country until your status is resolved.",
      "Do not begin or continue any work until your status is restored.",
      dest === "us" ? "Ask your DSO about SEVIS reinstatement and whether Form I-539 applies." : "Ask your advisor about the reinstatement process.",
    ];
    if (dest === "us") card.forms = ["I-539 (Application to Extend/Change Nonimmigrant Status)"];

  } else if (q.includes("deport") || (q.includes("removal") && (q.includes("visa") || q.includes("immigr") || q.includes("status")))) {
    card.title = "Removal proceedings — seek help now";
    card.steps = [
      "Contact your DSO immediately.",
      "Seek advice from a licensed immigration attorney.",
      "Do not ignore any official government correspondence.",
      "Contact the Omani Embassy in your country.",
    ];
    card.embassy = ESCALATION_EMBASSIES[dest] || ESCALATION_EMBASSIES.us;

  } else if (q.includes("hospital") || q.includes("ambulance") || (q.includes("emergency") && !q.includes("emergency contact") && !q.includes("emergency form"))) {
    card.title = "Medical emergency";
    const emergencyNum = dest === "au" ? "000" : dest === "uk" ? "999" : "911";
    card.steps = [
      `Call ${emergencyNum} immediately if this is life-threatening.`,
      "Contact your university health services.",
      dest === "au" ? "Have your OSHC insurance card ready." : dest === "uk" ? "Have your NHS or private insurance details ready." : "Have your health insurance card ready.",
      "Notify your DSO after the immediate situation is stabilized.",
    ];

  } else if (q.includes("evict")) {
    card.level = "warning";
    card.title = "Housing issue — know your rights";
    card.steps = [
      "Do not vacate without receiving proper written notice.",
      "Contact your university's student legal services or housing office.",
      "Document all communications with your landlord in writing.",
      "Ask your DSO if this could affect your enrollment status.",
    ];

  } else if (q.includes("expires") || q.includes("expiring") || q.includes("expiration") || q.includes("expired") || q.includes("expiry")) {
    card.level = "warning";
    card.title = "Document expiry — act before the deadline";
    card.steps = [
      "Contact your DSO immediately to confirm which document needs renewal.",
      dest === "us" ? "Request a program extension or new I-20 before the current one expires." : "Request an extension with your student visa sponsor before expiry.",
      "Do not book international travel until the renewed document is in hand.",
      "Check your passport: it must be valid at least 6 months beyond your program end date.",
    ];
    if (dest === "us") card.forms = ["I-20 Extension Request (via your DSO)"];

  } else if (q.includes("dismissed") || q.includes("dismissal") || q.includes("suspension") || q.includes("suspended") || q.includes("expelled") || q.includes("expulsion") || q.includes("probation")) {
    card.level = "warning";
    card.title = "Academic standing at risk";
    card.steps = [
      "Contact your academic advisor immediately.",
      "Contact your DSO — academic dismissal directly affects your visa status.",
      "MoHE-sponsored students must notify their MoHE scholarship office.",
      "Do not drop below full-time enrollment without DSO authorization.",
    ];

  } else if (q.includes("scholarship cancel") || q.includes("lost funding") || q.includes("funding cut") || q.includes("funding terminated")) {
    card.level = "warning";
    card.title = "Scholarship / funding change";
    card.steps = [
      "Contact your MoHE scholarship office immediately.",
      "Notify your DSO — your financial documentation must be updated.",
      "Do not make enrollment changes without consulting both MoHE and your DSO.",
    ];

  } else {
    card.level = "warning";
    card.title = "Time-sensitive — verify with your DSO";
    card.steps = [
      "Contact your DSO as soon as possible.",
      "Gather all relevant documents before reaching out.",
      "Do not take irreversible steps (travel, dropping courses, accepting work) until you have official guidance.",
    ];
  }

  return card;
}

// ── TF-IDF KB Search ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can",
  "this","that","these","those","it","its","their","they","them","we","our",
  "you","your","he","she","his","her","if","as","by","from","not","no",
  "also","all","any","each","than","up","out","so","about","after","before",
  "between","both","during","per","re","ve","about","into","through","such",
]);

// Recursively extract human-readable strings from a KB document object,
// skipping URLs and very short fragments.
function extractText(obj) {
  const parts = [];
  function walk(v) {
    if (typeof v === "string") {
      if (v.length > 3 && !v.startsWith("http")) parts.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  }
  walk(obj);
  return parts.join(" ");
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/([a-z0-9])-([a-z0-9])/g, "$1$2") // join hyphens: f-1→f1, i-20→i20
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function buildTFIDF(docs) {
  const docTokens = docs.map((doc) => tokenize(extractText(doc)));
  const N = docTokens.length;

  // Document frequency → smoothed IDF
  const df = {};
  for (const tokens of docTokens) {
    for (const t of new Set(tokens)) df[t] = (df[t] || 0) + 1;
  }
  const idf = {};
  for (const [t, d] of Object.entries(df)) {
    idf[t] = Math.log((N + 1) / (d + 1)) + 1;
  }

  // Per-document TF-IDF vectors
  const vectors = docTokens.map((tokens) => {
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const len = tokens.length || 1;
    const vec = {};
    for (const [t, c] of Object.entries(tf)) vec[t] = (c / len) * (idf[t] || 0);
    return vec;
  });

  return { idf, vectors };
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (const [t, a] of Object.entries(vecA)) {
    dot += a * (vecB[t] || 0);
    normA += a * a;
  }
  for (const b of Object.values(vecB)) normB += b * b;
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// TF-IDF index cache keyed by document fingerprint (count + boundary IDs).
// Rebuilt automatically when the KB is hot-reloaded.
const _tfidfCache = new Map();

function searchKB(knowledgeJson, query) {
  if (!knowledgeJson) return [];

  const docs = Array.isArray(knowledgeJson.documents)
    ? knowledgeJson.documents
    : Object.entries(knowledgeJson)
        .filter(([k]) => k !== "metadata")
        .map(([k, v]) => ({
          id: k,
          ...(typeof v === "object" && v !== null ? v : { content: v }),
        }));

  if (!docs.length) return [];

  // Phase 1: keyword matching — high-precision path for explicit compliance vocabulary.
  // Uses COMPLIANCE_TRIGGERS so domain terms always win over incidental token overlap.
  const qLower = query.toLowerCase();
  const kwResults = docs
    .map((doc) => {
      const text = extractText(doc).toLowerCase();
      const score = COMPLIANCE_TRIGGERS.filter((t) => qLower.includes(t) && text.includes(t)).length;
      return { doc, score, id: doc.id || "unknown" };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (kwResults.length > 0) return kwResults.slice(0, 3);

  // Phase 2: TF-IDF fallback — surfaces relevant documents for paraphrased queries
  // that contain no explicit compliance trigger words.
  const cacheKey = `${docs.length}:${docs[0]?.id}:${docs[docs.length - 1]?.id}`;
  if (!_tfidfCache.has(cacheKey)) {
    _tfidfCache.set(cacheKey, buildTFIDF(docs));
    if (_tfidfCache.size > 20) _tfidfCache.delete(_tfidfCache.keys().next().value);
  }
  const { idf, vectors } = _tfidfCache.get(cacheKey);

  const qTokens = tokenize(query);
  const qTF = {};
  for (const t of qTokens) qTF[t] = (qTF[t] || 0) + 1;
  const qLen = qTokens.length || 1;
  const qVec = {};
  for (const [t, c] of Object.entries(qTF)) {
    if (idf[t]) qVec[t] = (c / qLen) * idf[t];
  }

  return docs
    .map((doc, i) => ({ doc, score: cosineSimilarity(qVec, vectors[i]), id: doc.id || "unknown" }))
    .filter((r) => r.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
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
        query: `${query} official government university MoHE source`,
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

function sourceCategory(url = "") {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (hostname.endsWith(".gov") || hostname.includes("gov.uk") || hostname.includes("homeaffairs.gov.au")) return "Government";
    if (hostname.includes("mohe") || hostname.endsWith(".edu.om")) return "MoHE";
    if (hostname.endsWith(".edu") || hostname.includes(".ac.uk") || hostname.includes(".edu.au")) return "University";
    return "Official web";
  } catch {
    return "Official web";
  }
}

function buildSources(kbResults = [], webResults = []) {
  return [
    ...kbResults.map(r => ({
      type: "kb",
      id: r.id,
      title: r.doc.title || r.doc.topic || r.id,
      category: "OmanX dataset",
      verified: true,
    })),
    ...webResults.map(r => {
      let domain = r.url;
      try { domain = new URL(r.url).hostname.replace(/^www\./, ""); } catch {}
      return {
        type: "web",
        title: r.title,
        url: r.url,
        domain,
        category: sourceCategory(r.url),
        verified: true,
      };
    }),
  ];
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

function sanitizeImageAttachments(attachments, authUser) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  if (!authUser) {
    const error = new Error("Image upload requires Google sign-in.");
    error.status = 401;
    throw error;
  }
  if (attachments.length > MAX_IMAGE_ATTACHMENTS) {
    const error = new Error(`Attach up to ${MAX_IMAGE_ATTACHMENTS} images at a time.`);
    error.status = 400;
    throw error;
  }

  return attachments.map((item, index) => {
    const mediaType = typeof item?.type === "string" ? item.type.toLowerCase() : "";
    const rawData = typeof item?.data === "string" ? item.data : "";
    const data = rawData.includes(",") ? rawData.split(",").pop() : rawData;
    const name = typeof item?.name === "string" ? item.name.slice(0, 120) : `image-${index + 1}`;

    if (!ALLOWED_IMAGE_TYPES.has(mediaType)) {
      const error = new Error("Only PNG, JPEG, and WebP images are supported.");
      error.status = 400;
      throw error;
    }
    if (!/^[a-z0-9+/=]+$/i.test(data)) {
      const error = new Error("Image data is invalid.");
      error.status = 400;
      throw error;
    }

    const size = Buffer.byteLength(data, "base64");
    if (size > MAX_IMAGE_BYTES) {
      const mb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
      const error = new Error(`Each image must be ${mb}MB or smaller.`);
      error.status = 400;
      throw error;
    }

    return { name, mediaType, data, size };
  });
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

  const { message, history, model: clientModel, conciseMode, userContext, language, destination: clientDestination, webSearch: clientWebSearch, sessionId, attachments } = req.body || {};
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

  const auth = await getAuthUser(req);
  if (auth.error && auth.token) {
    return res.status(401).json({ error: auth.error });
  }

  let imageAttachments = [];
  try {
    imageAttachments = sanitizeImageAttachments(attachments, auth.user);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const sanitizedSessionId = getRequestSessionId(req, sessionId);
  const rateLimitKey = auth.user ? `user:${auth.user.id}` : getRateLimitKey(req, sanitizedSessionId);
  const usage = await consumeUsage(rateLimitKey);
  res.setHeader("X-RateLimit-Limit", String(usage.limit));
  res.setHeader("X-RateLimit-Remaining", String(usage.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(usage.resetAt / 1000)));

  if (!usage.allowed) {
    if (usage.blockedBy === "rate_limit_store") {
      return res.status(503).json({
        error: "Usage protection is not configured.",
        text: "OmanX is temporarily unavailable because production rate limiting is not configured.",
        usage,
      });
    }

    return res.status(429).json({
      error: "Daily message limit reached.",
      text: "You've reached today's anonymous message limit. Please come back tomorrow.",
      usage,
    });
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
  const userContent = imageAttachments.length
    ? [
        { type: "text", text: sanitizedMessage },
        ...imageAttachments.map((image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mediaType,
            data: image.data,
          },
        })),
      ]
    : sanitizedMessage;
  conversationMessages.push({ role: "user", content: userContent });

  const client = getClient();
  if (!client) {
    return res.status(500).json({
      text: "OmanX is not configured. Please contact the administrator.",
      error: "Anthropic client not configured",
    });
  }

  const compliance = isCompliance(sanitizedMessage);
  const destination = (typeof clientDestination === "string" && VALID_DESTINATIONS.has(clientDestination))
    ? clientDestination
    : detectDestination(sanitizedUserContext, sanitizedMessage);

  // Only cache non-compliance single-turn requests (compliance responses include live search data)
  const cacheKey = !hasHistory && !compliance && imageAttachments.length === 0
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
      res.write(`data: ${JSON.stringify({ done: true, compliance: false, webSearched: false, destination, usage })}\n\n`);
      return res.end();
    }
    return res.json({ text: cached, cached: true, usage });
  }

  let streamStarted = false;
  function ensureStream() {
    if (!wantsStream || streamStarted) return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    streamStarted = true;
  }

  function writeStatus(label, stage) {
    if (!wantsStream) return;
    ensureStream();
    res.write(`data: ${JSON.stringify({ status: label, stage })}\n\n`);
  }

  // Run KB lookup and web search in parallel
  let kbResults = [];
  let webResults = [];
  const allowWebSearch = clientWebSearch !== false;
  if (compliance) {
    writeStatus("Checking OmanX dataset...", "kb");
    if (allowWebSearch) writeStatus("Searching official sources...", "web");
    [kbResults, webResults] = await Promise.all([
      getKB(destination).then((kb) => (kb ? searchKB(kb, sanitizedMessage) : [])),
      allowWebSearch ? webSearch(`${sanitizedMessage}\n${sanitizedUserContext}`.slice(0, 2000)) : Promise.resolve([]),
    ]);
    if (allowWebSearch) {
      writeStatus(
        webResults.length
          ? `Verified ${webResults.length} official source${webResults.length === 1 ? "" : "s"}.`
          : "No official web result found; using saved rules.",
        "sources"
      );
    } else {
      writeStatus("Web search is off; using saved rules.", "sources");
    }
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
    attachments: imageAttachments.map((image) => ({ name: image.name, mediaType: image.mediaType, size: image.size })),
    authUserId: auth.user?.id || null,
    sessionId: sanitizedSessionId,
  });

  if (wantsStream) {
    ensureStream();
    writeStatus("Writing guidance...", "answer");

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
      const sources = buildSources(kbResults, webResults);
      const escalation = compliance && isUrgent(sanitizedMessage) ? buildEscalationCard(sanitizedMessage, destination) : null;
      res.write(`data: ${JSON.stringify({ done: true, compliance, webSearched: webResults.length > 0, sources, escalation, destination, usage })}\n\n`);
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
    return res.json({ text, cached: false, compliance, webSearched: webResults.length > 0, sources: buildSources(kbResults, webResults), usage });
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
