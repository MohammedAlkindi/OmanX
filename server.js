// server.js - Main entry point for OmanX Express server

import './config/env.js';
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import chatHandler from "./api/chat.js";
import healthHandler from "./api/health.js";
import readyHandler from "./api/ready.js";
import metricsHandler from "./api/metrics.js";
import authStartHandler from "./auth/start.js";
import authVerifyHandler from "./auth/verify.js";
import authSessionHandler from "./auth/session.js";
import authLogoutHandler from "./auth/logout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");

// Middleware
app.use(express.json({ limit: "1mb" }));

// Serve static files from public directory
app.use(express.static(PUBLIC_DIR));

// API Routes
app.post("/api/chat", chatHandler);
app.get("/api/health", healthHandler);
app.get("/api/ready", readyHandler);
app.get("/api/metrics", metricsHandler);
app.post("/api/auth/start", authStartHandler);
app.post("/api/auth/verify", authVerifyHandler);
app.get("/api/auth/session", authSessionHandler);
app.post("/api/auth/logout", authLogoutHandler);

// Page routes
app.get(["/", "/index.html"], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/system", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "system.html"));
});

app.get("/method", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "method.html"));
});

app.get("/vision", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "vision.html"));
});

app.get("/contact", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "contact.html"));
});

// Legacy redirects
app.get("/trust", (req, res) => res.redirect(301, "/system"));
app.get("/info", (req, res) => res.redirect(301, "/system"));

// Fallback
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  return res.status(404).sendFile(path.join(PUBLIC_DIR, "index.html"));
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
