// auth/exchange.js — Exchange an OAuth access_token (from URL hash) for a session cookie

import { requireAuthEnv, setSessionCookie } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const missing = requireAuthEnv();
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(", ")}` });
  }

  const { access_token, expires_in } = req.body || {};
  if (!access_token) {
    return res.status(400).json({ error: "access_token is required." });
  }

  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!response.ok) {
      return res.status(401).json({ error: "Invalid or expired access token." });
    }

    const user = await response.json();
    setSessionCookie(res, access_token, Number(expires_in) || 3600);

    return res.status(200).json({
      ok: true,
      user: { id: user.id, email: user.email },
    });
  } catch (error) {
    console.error("[auth/exchange] Error:", error.message);
    return res.status(500).json({ error: "Auth provider request failed." });
  }
}
