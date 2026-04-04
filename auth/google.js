// auth/google.js — Initiate Google OAuth via Supabase

import { requireAuthEnv } from "./_auth.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const missing = requireAuthEnv();
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(", ")}` });
  }

  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
  const redirectTo =
    process.env.AUTH_REDIRECT_URL ||
    (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/workspace` : null);

  if (!redirectTo) {
    return res.status(500).json({ error: "Auth redirect URL not configured." });
  }

  const params = new URLSearchParams({ provider: "google", redirect_to: redirectTo });
  res.redirect(302, `${supabaseUrl}/auth/v1/authorize?${params}`);
}
