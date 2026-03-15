// api/auth/start.js

import { requireAuthEnv } from "./_auth.js";

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const missing = requireAuthEnv();
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(", ")}` });
  }

  const { email } = req.body || {};
  if (!email || !validEmail(email)) {
    return res.status(400).json({ error: "Valid email is required." });
  }

  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
  const redirectTo = process.env.AUTH_REDIRECT_URL || `${process.env.APP_BASE_URL || ""}/`;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email,
        create_user: true,
        gotrue_meta_security: { captcha_token: null },
        data: { app: "omanx" },
        options: {
          email_redirect_to: redirectTo,
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: payload?.msg || "Failed to send magic link." });
    }

    return res.status(200).json({ ok: true, message: "Magic link sent." });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Auth provider request failed." });
  }
}
