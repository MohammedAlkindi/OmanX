// api/health.js - OmanX health check endpoint

export default function healthHandler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    service: "omanx",
    route: "health",
    timestamp: new Date().toISOString()
  });
}
