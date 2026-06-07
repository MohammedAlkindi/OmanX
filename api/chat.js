// api/chat.js - API route for OmanX chatbot

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KNOWLEDGE_PATHS = [
  path.join(process.cwd(), "data/knowledge.json"),
  path.join(__dirname, "../data/knowledge.json"),
  path.join(__dirname, "../../data/knowledge.json"),
];

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ALLOWED_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"];

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

function buildSystemPrompt(kbResults, userContext) {
  let system = BASE_SYSTEM;
  if (userContext && typeof userContext === "string" && userContext.trim()) {
    system += `\n\n## Student context\n${userContext.trim()}`;
  }
  if (!kbResults || kbResults.length === 0) return system;
  const kbSection = kbResults
    .map((r, i) => `### KB Entry ${i + 1} — ID: ${r.id}\n${JSON.stringify(r.doc, null, 2)}`)
    .join("\n\n");
  return `${system}\n\n---\n\n## Relevant Knowledge Base Entries\nUse ONLY these entries for compliance guidance. Cite the entry ID when referencing them.\n\n${kbSection}`;
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, history, model, userContext } = req.body || {};

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

  const client = getClient();
  if (!client) {
    return res.status(500).json({
      text: "OmanX is not configured. Please contact the administrator.",
      error: "Anthropic client not configured",
    });
  }

  const resolvedModel = ALLOWED_MODELS.includes(model) ? model : MODEL;

  const validHistory = Array.isArray(history)
    ? history
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: sanitizeMessage(m.content) }))
    : [];

  const messages = [...validHistory, { role: "user", content: sanitizedMessage }];

  const compliance = isCompliance(sanitizedMessage);
  let kbResults = [];
  if (compliance) {
    const kb = await getKB();
    if (kb) kbResults = searchKB(kb, sanitizedMessage);
  }

  const sanitizedUserContext = typeof userContext === "string" ? userContext.slice(0, 2000) : "";
  const systemPrompt = buildSystemPrompt(kbResults, sanitizedUserContext);

  // Initiate the stream BEFORE setting SSE headers so rate-limit/auth errors return clean JSON
  let stream;
  try {
    console.log("[OmanX] /api/chat stream", { compliance, chars: sanitizedMessage.length, model: resolvedModel, historyTurns: validHistory.length });

    stream = await client.messages.create({
      model: resolvedModel,
      max_tokens: 1024,
      temperature: 0.4,
      system: systemPrompt,
      messages,
      stream: true,
    });
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

  // Stream created successfully — switch to SSE mode
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (res.socket) res.socket.setNoDelay(true);
  res.flushHeaders();

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("[OmanX] Mid-stream error:", err?.message);
    res.write(`data: ${JSON.stringify({ error: "Stream interrupted. Please try again." })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}
