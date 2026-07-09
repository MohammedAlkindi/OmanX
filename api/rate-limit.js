import { Redis } from "@upstash/redis";
import crypto from "crypto";

export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_DAILY_MAX || 20);
export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const _rateLimitMap = new Map();
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function hashKeyPart(value) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24);
}

export function sanitizeSessionId(sessionId) {
  return typeof sessionId === "string"
    ? sessionId.slice(0, 64).replace(/[^a-z0-9\-]/gi, "")
    : "";
}

function getQueryParam(req, name) {
  if (req.query && typeof req.query[name] === "string") return req.query[name];
  try {
    const url = new URL(req.url || "", "http://localhost");
    return url.searchParams.get(name) || "";
  } catch {
    return "";
  }
}

export function getRequestSessionId(req, bodySessionId) {
  return sanitizeSessionId(bodySessionId || getQueryParam(req, "sessionId"));
}

export function getRateLimitKey(req, sessionId = "") {
  const sanitizedSessionId = sanitizeSessionId(sessionId);
  const ip = getClientIp(req);
  if (ip && ip !== "unknown") return `ip:${hashKeyPart(ip)}`;
  if (sanitizedSessionId) return `session:${sanitizedSessionId}`;
  return "ip:unknown";
}

function toUsage({ allowed = true, count = 0, limit = RATE_LIMIT_MAX, resetAt = Date.now() + RATE_LIMIT_WINDOW_MS, source = "memory", window = "day", blockedBy = null } = {}) {
  const used = Math.min(count, limit);
  const remaining = Math.max(limit - count, 0);
  return {
    allowed,
    limit,
    used,
    remaining,
    percentUsed: Math.min(Math.round((used / limit) * 100), 100),
    resetAt,
    resetInMs: Math.max(resetAt - Date.now(), 0),
    source,
    window,
    blockedBy,
  };
}

function memoryBucketUsage(key, { consume = false, limit = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS, window = "day" } = {}) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const entry = _rateLimitMap.get(key) || [];
  const hits = entry.filter((ts) => ts > cutoff);

  if (consume) hits.push(now);
  if (hits.length) _rateLimitMap.set(key, hits);
  else _rateLimitMap.delete(key);

  if (_rateLimitMap.size > 5000) {
    for (const [mapKey, timestamps] of _rateLimitMap) {
      const fresh = timestamps.filter((ts) => ts > cutoff);
      if (fresh.length) _rateLimitMap.set(mapKey, fresh);
      else _rateLimitMap.delete(mapKey);
    }
  }

  const resetAt = hits.length ? Math.min(...hits) + windowMs : now + windowMs;
  return toUsage({
    allowed: hits.length <= limit,
    count: hits.length,
    limit,
    resetAt,
    source: "memory",
    window,
  });
}

async function redisBucketUsage(key, { consume = false, limit = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS, window = "day" } = {}) {
  const redis = getRedis();
  if (!redis) return null;

  const now = Date.now();
  const redisKey = `omanx:usage:${key}`;
  await redis.zremrangebyscore(redisKey, 0, now - windowMs);
  if (consume) {
    await redis.zadd(redisKey, { score: now, member: `${now}:${crypto.randomUUID()}` });
  }
  const count = await redis.zcard(redisKey);
  await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 5);

  return toUsage({
    allowed: count <= limit,
    count,
    limit,
    resetAt: now + windowMs,
    source: "redis",
    window,
  });
}

export async function getUsage(key) {
  const dailyKey = `daily:${key}`;
  try {
    const usage = await redisBucketUsage(dailyKey, { consume: false, limit: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, window: "day" });
    if (usage) return usage;
  } catch (error) {
    console.warn("[OmanX] Redis usage read failed:", error.message);
  }
  return memoryBucketUsage(dailyKey, { consume: false, limit: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, window: "day" });
}

export async function consumeUsage(key) {
  const dailyKey = `daily:${key}`;

  try {
    const dailyUsage = await redisBucketUsage(dailyKey, { consume: true, limit: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, window: "day" });
    if (dailyUsage) return dailyUsage;
  } catch (error) {
    console.warn("[OmanX] Redis usage write failed:", error.message);
  }

  return memoryBucketUsage(dailyKey, { consume: true, limit: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, window: "day" });
}
