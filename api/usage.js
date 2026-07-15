import { getRateLimitKey, getRequestSessionId, getUsage, RATE_LIMIT_GUEST_MAX, RATE_LIMIT_SIGNED_IN_MAX } from "./rate-limit.js";
import { getAuthUser, publicUser } from "./auth-utils.js";

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const requestOrigin = req.headers.origin;
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthUser(req);
  if (auth.error && auth.token) {
    return res.status(401).json({ error: auth.error });
  }

  const isSignedIn = !!auth.user;
  const sessionId = getRequestSessionId(req);
  const key = isSignedIn ? `user:${auth.user.id}` : getRateLimitKey(req, sessionId);
  const usage = await getUsage(key, {
    limit: isSignedIn ? RATE_LIMIT_SIGNED_IN_MAX : RATE_LIMIT_GUEST_MAX,
  });

  res.setHeader("Cache-Control", "no-store");
  return res.json({
    usage: { ...usage, access: isSignedIn ? "signed-in" : "guest" },
    user: publicUser(auth.user),
    access: isSignedIn ? "signed-in" : "guest",
  });
}
