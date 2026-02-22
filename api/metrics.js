// api/metrics.js - OmanX metrics endpoint

export default async function handler(req, res) {
  return res.status(200).json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
}