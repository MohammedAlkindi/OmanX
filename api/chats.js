import { createSupabaseUserClient, getAuthUser } from "./_auth-utils.js";

const TABLE_NAME = "omanx_chat_sync";
const MAX_CHATS = 50;
const MAX_MESSAGES_PER_CHAT = 250;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_SYNC_BYTES = 1_500_000;

function applyCors(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const requestOrigin = req.headers.origin;
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function jsonError(res, status, error, code) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}

function isMissingStorageError(error) {
  const message = `${error?.message || ""} ${error?.details || ""}`;
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST106" ||
    error?.code === "PGRST205" ||
    /relation .* does not exist/i.test(message) ||
    /could not find .*table/i.test(message)
  );
}

function toText(value, max, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, max);
}

function toId(value, fallback = "") {
  const text = toText(value, 96, fallback).trim();
  return /^[a-zA-Z0-9:_-]+$/.test(text) ? text : fallback;
}

function toTimestamp(value, fallback) {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function sanitizeSources(sources) {
  if (!Array.isArray(sources)) return undefined;
  const clean = sources.slice(0, 12).map((source) => {
    if (!source || typeof source !== "object") return null;
    const url = toText(source.url, 1000);
    return compactObject({
      type: toText(source.type, 40),
      id: toText(source.id, 120),
      title: toText(source.title, 300),
      category: toText(source.category, 120),
      domain: toText(source.domain, 160),
      url: /^https?:\/\//i.test(url) ? url : "",
    });
  }).filter(Boolean);
  return clean.length ? clean : undefined;
}

function sanitizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return undefined;
  const clean = attachments.slice(0, 8).map((attachment) => {
    if (!attachment || typeof attachment !== "object") return null;
    return compactObject({
      name: toText(attachment.name, 180, "Image"),
      type: toText(attachment.type, 80),
      size: Number.isFinite(attachment.size) ? Math.max(0, Math.round(attachment.size)) : undefined,
    });
  }).filter(Boolean);
  return clean.length ? clean : undefined;
}

function sanitizeEscalation(escalation) {
  if (!escalation || typeof escalation !== "object") return undefined;
  const embassy = escalation.embassy && typeof escalation.embassy === "object"
    ? compactObject({
        name: toText(escalation.embassy.name, 180),
        note: toText(escalation.embassy.note, 500),
      })
    : undefined;

  return compactObject({
    level: escalation.level === "urgent" ? "urgent" : escalation.level === "warning" ? "warning" : undefined,
    title: toText(escalation.title, 220),
    steps: Array.isArray(escalation.steps) ? escalation.steps.slice(0, 10).map((step) => toText(step, 600)).filter(Boolean) : undefined,
    forms: Array.isArray(escalation.forms) ? escalation.forms.slice(0, 10).map((form) => toText(form, 120)).filter(Boolean) : undefined,
    embassy: embassy && Object.keys(embassy).length ? embassy : undefined,
    dsoNote: toText(escalation.dsoNote, 800),
  });
}

function sanitizeMessage(message, index) {
  if (!message || typeof message !== "object") return null;
  const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : "";
  if (!role) return null;

  const now = new Date().toISOString();
  const createdAt = toTimestamp(message.createdAt, now);
  return compactObject({
    id: toId(message.id, `msg_${index}`),
    role,
    content: String(message.content ?? "").slice(0, MAX_MESSAGE_CHARS),
    createdAt,
    webSearched: message.webSearched === true ? true : undefined,
    destination: ["us", "uk", "au"].includes(message.destination) ? message.destination : undefined,
    sources: sanitizeSources(message.sources),
    escalation: sanitizeEscalation(message.escalation),
    attachments: sanitizeAttachments(message.attachments),
  });
}

function sanitizeChat(chat, index) {
  if (!chat || typeof chat !== "object") return null;
  const now = new Date().toISOString();
  const createdAt = toTimestamp(chat.createdAt, now);
  const updatedAt = toTimestamp(chat.updatedAt, createdAt);
  const messages = Array.isArray(chat.messages)
    ? chat.messages.slice(-MAX_MESSAGES_PER_CHAT).map(sanitizeMessage).filter(Boolean)
    : [];

  return {
    id: toId(chat.id, `chat_${index}`),
    title: toText(chat.title, 160, "New chat").trim() || "New chat",
    category: toText(chat.category, 80, "General").trim() || "General",
    pinned: chat.pinned === true,
    createdAt,
    updatedAt,
    messages,
  };
}

function normalizeBaseUpdatedAt(value) {
  return typeof value === "string" && value ? value : null;
}

function sameTimestamp(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime === bTime;
  return a === b;
}

function sanitizeSnapshot(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.chats)) {
    const error = new Error("Missing 'chats' array.");
    error.status = 400;
    throw error;
  }

  const chats = body.chats.slice(0, MAX_CHATS).map(sanitizeChat).filter((chat) => chat?.id);
  const activeChatId = toId(body.activeChatId, "");
  const active = chats.some((chat) => chat.id === activeChatId) ? activeChatId : chats[0]?.id || "";
  const serializedBytes = Buffer.byteLength(JSON.stringify(chats), "utf8");

  if (serializedBytes > MAX_SYNC_BYTES) {
    const error = new Error("Chat history is too large to sync. Export or delete older conversations, then try again.");
    error.status = 413;
    throw error;
  }

  return {
    chats,
    activeChatId: active,
    baseUpdatedAt: normalizeBaseUpdatedAt(body.baseUpdatedAt),
    hasBaseUpdatedAt: Object.prototype.hasOwnProperty.call(body, "baseUpdatedAt"),
  };
}

function formatSnapshot(row) {
  if (!row) {
    return { chats: [], activeChatId: "", updatedAt: null };
  }

  const chats = Array.isArray(row.chats) ? row.chats : [];
  return {
    chats,
    activeChatId: typeof row.active_chat_id === "string" ? row.active_chat_id : "",
    updatedAt: row.updated_at || null,
  };
}

async function readSnapshot(supabase, userId) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("chats,active_chat_id,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function requireAuth(req, res) {
  const auth = await getAuthUser(req);
  if (auth.error && auth.token) {
    jsonError(res, 401, auth.error);
    return null;
  }
  if (!auth.user || !auth.token) {
    jsonError(res, 401, "Sign in to sync chat history.", "auth_required");
    return null;
  }
  return auth;
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "PUT") {
    return jsonError(res, 405, "Method not allowed");
  }

  const auth = await requireAuth(req, res);
  if (!auth) return undefined;

  const supabase = createSupabaseUserClient(auth.token);
  if (!supabase) {
    return jsonError(res, 503, "Chat sync is not configured.", "chat_sync_not_configured");
  }

  try {
    if (req.method === "GET") {
      const row = await readSnapshot(supabase, auth.user.id);
      return res.status(200).json(formatSnapshot(row));
    }

    const snapshot = sanitizeSnapshot(req.body || {});
    const existing = await readSnapshot(supabase, auth.user.id);
    const existingUpdatedAt = existing?.updated_at || null;

    if (snapshot.hasBaseUpdatedAt && !sameTimestamp(snapshot.baseUpdatedAt, existingUpdatedAt)) {
      return res.status(409).json({
        error: "Chat history changed on another device.",
        code: "sync_conflict",
        snapshot: formatSnapshot(existing),
      });
    }

    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .upsert({
        user_id: auth.user.id,
        chats: snapshot.chats,
        active_chat_id: snapshot.activeChatId,
        updated_at: updatedAt,
      }, { onConflict: "user_id" })
      .select("chats,active_chat_id,updated_at")
      .single();

    if (error) throw error;
    return res.status(200).json(formatSnapshot(data));
  } catch (error) {
    if (isMissingStorageError(error)) {
      return jsonError(res, 503, "Chat sync storage has not been set up.", "chat_sync_not_configured");
    }

    if (error.status) return jsonError(res, error.status, error.message);
    console.error("Chat sync error:", error);
    return jsonError(res, 500, "Could not sync chat history.");
  }
}
