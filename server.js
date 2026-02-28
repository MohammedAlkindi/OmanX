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
const publicDir = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Serve static files from /public after frontend reorganization
app.use(express.static(publicDir));

// API Routes
app.post("/api/chat", chatHandler);
app.get("/api/health", healthHandler);
app.get("/api/ready", readyHandler);
app.get("/api/metrics", metricsHandler);

// Legacy non-/api aliases
app.post("/chat", chatHandler);
app.get("/health", healthHandler);
app.get("/ready", readyHandler);
app.get("/metrics", metricsHandler);

// Unknown API route handler
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// SPA/static fallback to /public/index.html
app.use((req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OmanX running at http://localhost:${PORT}`);
});
