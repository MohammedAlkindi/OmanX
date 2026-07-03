import { Redis } from "@upstash/redis";
import crypto from "crypto";

export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;

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

export function sanitizeSessionId(sessionId) {
  return typeof sessionId === "string"
    ? sessionId.slice(0, 64).replace(/[^a-z0-9\-]/gi, "")
    : "";
}

export function getRateLimitKey(req, sessionId) {
  const cleanSessionId = sanitizeSessionId(sessionId);
  if (cleanSessionId) return `session:${cleanSessionId}`;
  return `ip:${getClientIp(req)}`;
}

function toUsage({ allowed = true, count = 0, resetAt = Date.now() + RATE_LIMIT_WINDOW_MS, source = "memory" } = {}) {
  const used = Math.min(count, RATE_LIMIT_MAX);
  const remaining = Math.max(RATE_LIMIT_MAX - count, 0);
  return {
    allowed,
    limit: RATE_LIMIT_MAX,
    used,
    remaining,
    percentUsed: Math.min(Math.round((used / RATE_LIMIT_MAX) * 100), 100),
    resetAt,
    resetInMs: Math.max(resetAt - Date.now(), 0),
    source,
  };
}

function memoryUsage(key, { consume = false } = {}) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
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

  const resetAt = hits.length ? Math.min(...hits) + RATE_LIMIT_WINDOW_MS : now + RATE_LIMIT_WINDOW_MS;
  return toUsage({
    allowed: hits.length <= RATE_LIMIT_MAX,
    count: hits.length,
    resetAt,
    source: "memory",
  });
}

async function redisUsage(key, { consume = false } = {}) {
  const redis = getRedis();
  if (!redis) return null;

  const now = Date.now();
  const redisKey = `omanx:usage:${key}`;
  await redis.zremrangebyscore(redisKey, 0, now - RATE_LIMIT_WINDOW_MS);
  if (consume) {
    await redis.zadd(redisKey, { score: now, member: `${now}:${crypto.randomUUID()}` });
  }
  const count = await redis.zcard(redisKey);
  await redis.expire(redisKey, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 5);

  return toUsage({
    allowed: count <= RATE_LIMIT_MAX,
    count,
    resetAt: now + RATE_LIMIT_WINDOW_MS,
    source: "redis",
  });
}

export async function getUsage(key) {
  try {
    const usage = await redisUsage(key, { consume: false });
    if (usage) return usage;
  } catch (error) {
    console.warn("[OmanX] Redis usage read failed:", error.message);
  }
  return memoryUsage(key, { consume: false });
}

export async function consumeUsage(key) {
  try {
    const usage = await redisUsage(key, { consume: true });
    if (usage) return usage;
  } catch (error) {
    console.warn("[OmanX] Redis usage write failed:", error.message);
  }
  return memoryUsage(key, { consume: true });
}
