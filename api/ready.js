// api/ready.js - OmanX readiness check endpoint

export default function readyHandler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    ready: true,
    service: "omanx",
    timestamp: new Date().toISOString()
  });
}
