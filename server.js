import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import chatHandler from "./api/chat.js";
import healthHandler from "./api/health.js";
import readyHandler from "./api/ready.js";
import metricsHandler from "./api/metrics.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();

// Middleware
app.use(express.json({ limit: "1mb" }));

// Serve static files from root directory
app.use(express.static(__dirname));

// API Routes
app.post("/api/chat", chatHandler);
app.get("/api/health", healthHandler);
app.get("/api/ready", readyHandler);
app.get("/api/metrics", metricsHandler);

// Also support non-/api routes for backward compatibility
app.post("/chat", chatHandler);
app.get("/health", healthHandler);
app.get("/ready", readyHandler);
app.get("/metrics", metricsHandler);

// SPA fallback - serve index.html for all other routes
// FIX: Use a more specific pattern or use app.use for catch-all
app.use((req, res) => {
  // Skip API routes that weren't found
  if (req.path.startsWith('/api/') || req.path.startsWith('/chat') || 
      req.path.startsWith('/health') || req.path.startsWith('/ready') || 
      req.path.startsWith('/metrics')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OmanX running at http://localhost:${PORT}`);
  console.log(`API endpoints available at:`);
  console.log(`  - http://localhost:${PORT}/api/chat`);
  console.log(`  - http://localhost:${PORT}/api/health`);
  console.log(`  - http://localhost:${PORT}/api/ready`);
  console.log(`  - http://localhost:${PORT}/api/metrics`);
});