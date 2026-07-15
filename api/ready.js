// api/ready.js - OmanX readiness check endpoint

import { checkPersistentRateLimitStore, requiresPersistentRateLimitStore } from "./rate-limit.js";

export default async function handler(req, res) {
  const rateLimitStoreRequired = requiresPersistentRateLimitStore();
  const rateLimitStore = await checkPersistentRateLimitStore();
  const rateLimitStoreReady = rateLimitStore.ready;
  const ready = !rateLimitStoreRequired || rateLimitStoreReady;

  return res.status(ready ? 200 : 503).json({
    ready,
    service: "omanx",
    timestamp: new Date().toISOString(),
    checks: {
      rateLimitStore: {
        ready: rateLimitStoreReady,
        required: rateLimitStoreRequired,
        source: rateLimitStore.source,
        message: rateLimitStore.message,
      },
    },
  });
}
