// api/ready.js - OmanX readiness check endpoint

import { checkPersistentRateLimitStore, requiresPersistentRateLimitStore } from "./_rate-limit.js";

export default async function handler(req, res) {
  const store = await checkPersistentRateLimitStore();
  const rateLimitStoreReady = store.ready;
  const rateLimitStoreRequired = requiresPersistentRateLimitStore();
  const rateLimitStoreConfigured = store.source === "upstash";
  const ready = rateLimitStoreReady || (!rateLimitStoreRequired && !rateLimitStoreConfigured);

  return res.status(ready ? 200 : 503).json({
    ready,
    service: "omanx",
    timestamp: new Date().toISOString(),
    checks: {
      rateLimitStore: {
        ready: rateLimitStoreReady,
        required: rateLimitStoreRequired,
        configured: rateLimitStoreConfigured,
        source: store.source,
        message: store.message,
        ...(store.error ? { error: store.error } : {}),
      },
    },
  });
}
