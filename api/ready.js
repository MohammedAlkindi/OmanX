// api/ready.js - OmanX readiness check endpoint

export default async function handler(req, res) {
  return res.status(200).json({
    ready: true,
    service: "omanx",
    timestamp: new Date().toISOString()
  });
}