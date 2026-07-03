import { getRateLimitKey, getUsage, sanitizeSessionId } from "./rate-limit.js";

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

  const sessionId = sanitizeSessionId(req.query?.sessionId);
  const key = getRateLimitKey(req, sessionId);
  const usage = await getUsage(key);

  res.setHeader("Cache-Control", "no-store");
  return res.json({ usage });
}
