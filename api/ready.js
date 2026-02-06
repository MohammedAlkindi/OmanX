import app from "../app.server.js";

export default async function handler(req, res) {
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  req.url = `/ready${query}`;
  return app(req, res);
}
