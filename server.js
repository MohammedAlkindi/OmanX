// server.js - Main entry point for OmanX Express server

import './env.js';
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import chatHandler from "./api/chat.js";
import healthHandler from "./api/health.js";
import readyHandler from "./api/ready.js";
import metricsHandler from "./api/metrics.js";
import authStartHandler from "./api/auth/start.js";
import authVerifyHandler from "./api/auth/verify.js";
import authSessionHandler from "./api/auth/session.js";
import authLogoutHandler from "./api/auth/logout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();

// Middleware
app.use(express.json({ limit: "1mb" }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// API Routes
app.post("/api/chat", chatHandler);
app.get("/api/health", healthHandler);
app.get("/api/ready", readyHandler);
app.get("/api/metrics", metricsHandler);
app.post("/api/auth/start", authStartHandler);
app.post("/api/auth/verify", authVerifyHandler);
app.get("/api/auth/session", authSessionHandler);
app.post("/api/auth/logout", authLogoutHandler);

// SPA fallback — only serve index.html for non-API paths
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OmanX running at http://localhost:${PORT}`);
  console.log(`API endpoints available at:`);
  console.log(`  - http://localhost:${PORT}/api/chat`);
  console.log(`  - http://localhost:${PORT}/api/health`);
  console.log(`  - http://localhost:${PORT}/api/ready`);
  console.log(`  - http://localhost:${PORT}/api/metrics`);
});