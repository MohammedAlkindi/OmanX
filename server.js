// server.js — OmanX local dev server

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
// FIX: Use a function instead of "*" to avoid path-to-regexp error
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OmanX running at http://localhost:${PORT}`);
  console.log(`API endpoints available at:`);
  console.log(`  - http://localhost:${PORT}/api/chat`);
  console.log(`  - http://localhost:${PORT}/api/health`);
  console.log(`  - http://localhost:${PORT}/api/ready`);
  console.log(`  - http://localhost:${PORT}/api/metrics`);
});