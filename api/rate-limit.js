import { Redis } from "@upstash/redis";
import crypto from "crypto";

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const ANONYMOUS_RATE_LIMIT_MAX = readPositiveInt("RATE_LIMIT_ANONYMOUS_DAILY_MAX", 3);
export const AUTHENTICATED_RATE_LIMIT_MAX = readPositiveInt("RATE_LIMIT_AUTHENTICATED_DAILY_MAX", 50);
export const RATE_LIMIT_MAX = ANONYMOUS_RATE_LIMIT_MAX;
export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Bounds a full Redis bucket operation (several sequential commands) so a
// slow or unreachable Upstash endpoint fails closed quickly instead of
// holding the request open until the platform's function timeout.
const REDIS_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const _rateLimitMap = new Map();
let _redis = null;
let _warnedNoRedis = false;
let _warnedRedisUnavailable = false;

export function hasPersistentRateLimitStore() {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  return Boolean(url && token);
}

export function requiresPersistentRateLimitStore() {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function warnMissingPersistentRateLimitStore() {
  if (!requiresPersistentRateLimitStore() || _warnedNoRedis) return;
  _warnedNoRedis = true;
  console.error(
    "[OmanX] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are not set. " +
    "Persistent rate limiting is unavailable, so production chat requests fail closed. " +
    "Set both env vars before onboarding real users."
  );
}

function warnUnavailablePersistentRateLimitStore(error, operation = "operation") {
  if (_warnedRedisUnavailable) return;
  _warnedRedisUnavailable = true;
  console.error(
    `[OmanX] Upstash Redis rate limit ${operation} failed. ` +
    "Production chat requests fail closed instead of using non-durable memory limits.",
    error?.message || error
  );
}

function getRedis() {
  if (_redis) return _redis;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  if (!url || !token) {
    warnMissingPersistentRateLimitStore();
    return null;
  }
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
  if (sanitizedSessionId) return `session:${hashKeyPart(sanitizedSessionId)}`;
  if (ip && ip !== "unknown") return `ip:${hashKeyPart(ip)}`;
  return "ip:unknown";
}

export function getQuotaForUser(user) {
  return user
    ? { tier: "authenticated", limit: AUTHENTICATED_RATE_LIMIT_MAX }
    : { tier: "anonymous", limit: ANONYMOUS_RATE_LIMIT_MAX };
}

function toUsage({ allowed = null, count = 0, limit = RATE_LIMIT_MAX, resetAt = Date.now() + RATE_LIMIT_WINDOW_MS, source = "memory", window = "day", blockedBy = null, tier = "anonymous" } = {}) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RATE_LIMIT_MAX;
  const used = Math.min(count, safeLimit);
  const remaining = Math.max(safeLimit - count, 0);
  return {
    allowed: allowed ?? count < safeLimit,
    limit: safeLimit,
    used,
    remaining,
    percentUsed: Math.min(Math.round((used / safeLimit) * 100), 100),
    resetAt,
    resetInMs: Math.max(resetAt - Date.now(), 0),
    source,
    window,
    blockedBy,
    tier,
  };
}

function blockedPersistentStoreUsage({ limit = RATE_LIMIT_MAX, tier = "anonymous", window = "day", source = "missing-persistent-store" } = {}) {
  return toUsage({
    allowed: false,
    count: limit,
    limit,
    resetAt: Date.now() + RATE_LIMIT_WINDOW_MS,
    source,
    window,
    blockedBy: "rate_limit_store",
    tier,
  });
}

function missingPersistentStoreUsage({ limit = RATE_LIMIT_MAX, tier = "anonymous", window = "day" } = {}) {
  warnMissingPersistentRateLimitStore();
  return blockedPersistentStoreUsage({
    limit,
    tier,
    window,
    source: "missing-persistent-store",
  });
}

function unavailablePersistentStoreUsage({ limit = RATE_LIMIT_MAX, tier = "anonymous", window = "day", operation = "operation", error } = {}) {
  warnUnavailablePersistentRateLimitStore(error, operation);
  return blockedPersistentStoreUsage({
    limit,
    tier,
    window,
    source: "unavailable-persistent-store",
  });
}

function memoryBucketUsage(key, { consume = false, limit = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS, window = "day", tier = "anonymous" } = {}) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const entry = _rateLimitMap.get(key) || [];
  const hits = entry.filter((ts) => ts > cutoff);
  const canConsume = hits.length < limit;

  if (consume && canConsume) hits.push(now);
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
    allowed: consume ? canConsume : hits.length < limit,
    count: hits.length,
    limit,
    resetAt,
    source: "memory",
    window,
    tier,
  });
}

async function redisBucketUsage(key, { consume = false, limit = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS, window = "day", tier = "anonymous" } = {}) {
  const redis = getRedis();
  if (!redis) return null;

  const now = Date.now();
  const redisKey = `omanx:usage:${key}`;
  await redis.zremrangebyscore(redisKey, 0, now - windowMs);
  const currentCount = await redis.zcard(redisKey);
  const canConsume = currentCount < limit;
  const count = consume && canConsume ? currentCount + 1 : currentCount;
  if (consume && canConsume) {
    await redis.zadd(redisKey, { score: now, member: `${now}:${crypto.randomUUID()}` });
  }
  if (count > 0) await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 5);

  return toUsage({
    allowed: consume ? canConsume : currentCount < limit,
    count,
    limit,
    resetAt: now + windowMs,
    source: "redis",
    window,
    tier,
  });
}

export async function checkPersistentRateLimitStore() {
  if (!hasPersistentRateLimitStore()) {
    return {
      ready: false,
      source: "memory",
      message: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before production use.",
    };
  }

  try {
    const redis = getRedis();
    await withTimeout(redis.ping(), REDIS_TIMEOUT_MS, "rate limit health check");
    return { ready: true, source: "upstash", message: "Persistent rate limit store is reachable." };
  } catch (error) {
    warnUnavailablePersistentRateLimitStore(error, "health check");
    return {
      ready: false,
      source: "upstash",
      message: "Persistent rate limit store is configured but unavailable.",
      error: error?.message || String(error),
    };
  }
}

export async function getUsage(key, { limit = RATE_LIMIT_MAX, tier = "anonymous" } = {}) {
  const dailyKey = `daily:${key}`;
  if (requiresPersistentRateLimitStore() && !hasPersistentRateLimitStore()) {
    return missingPersistentStoreUsage({ limit, tier, window: "day" });
  }

  if (hasPersistentRateLimitStore()) {
    try {
      const usage = await withTimeout(
        redisBucketUsage(dailyKey, { consume: false, limit, windowMs: RATE_LIMIT_WINDOW_MS, window: "day", tier }),
        REDIS_TIMEOUT_MS,
        "rate limit read"
      );
      if (usage) return usage;
    } catch (error) {
      return unavailablePersistentStoreUsage({ limit, tier, window: "day", operation: "read", error });
    }
  }

  return memoryBucketUsage(dailyKey, { consume: false, limit, windowMs: RATE_LIMIT_WINDOW_MS, window: "day", tier });
}

export async function consumeUsage(key, { limit = RATE_LIMIT_MAX, tier = "anonymous" } = {}) {
  const dailyKey = `daily:${key}`;
  if (requiresPersistentRateLimitStore() && !hasPersistentRateLimitStore()) {
    return missingPersistentStoreUsage({ limit, tier, window: "day" });
  }

  if (hasPersistentRateLimitStore()) {
    try {
      const dailyUsage = await withTimeout(
        redisBucketUsage(dailyKey, { consume: true, limit, windowMs: RATE_LIMIT_WINDOW_MS, window: "day", tier }),
        REDIS_TIMEOUT_MS,
        "rate limit write"
      );
      if (dailyUsage) return dailyUsage;
    } catch (error) {
      return unavailablePersistentStoreUsage({ limit, tier, window: "day", operation: "write", error });
    }
  }

  return memoryBucketUsage(dailyKey, { consume: true, limit, windowMs: RATE_LIMIT_WINDOW_MS, window: "day", tier });
}
