import app from "./app.server.js";

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, () => {
  console.log(`OmanX running at http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
