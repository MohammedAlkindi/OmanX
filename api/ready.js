// api/ready.js - OmanX readiness check endpoint

import { hasPersistentRateLimitStore, requiresPersistentRateLimitStore } from "./rate-limit.js";

export default async function handler(req, res) {
  const rateLimitStoreReady = hasPersistentRateLimitStore();
  const rateLimitStoreRequired = requiresPersistentRateLimitStore();
  const ready = !rateLimitStoreRequired || rateLimitStoreReady;

  return res.status(ready ? 200 : 503).json({
    ready,
    service: "omanx",
    timestamp: new Date().toISOString(),
    checks: {
      rateLimitStore: {
        ready: rateLimitStoreReady,
        required: rateLimitStoreRequired,
        source: rateLimitStoreReady ? "upstash" : "memory",
        message: rateLimitStoreReady
          ? "Persistent rate limit store configured."
          : "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before production use.",
      },
    },
  });
}
