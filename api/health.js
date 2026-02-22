// api/health.js - OmanX health check endpoint

export default function healthHandler(req, res) {
  return res.status(200).json({
    ok: true,
    service: "omanx",
    route: "health",
    timestamp: new Date().toISOString()
  });
}