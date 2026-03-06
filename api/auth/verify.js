// api/auth/verify.js

import { requireAuthEnv, setSessionCookie } from "../_auth.js";

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

  const { token_hash, type } = req.body || {};
  if (!token_hash || !type) {
    return res.status(400).json({ error: "token_hash and type are required." });
  }

  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ token_hash, type }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: payload?.msg || "Session verification failed." });
    }

    const accessToken = payload?.access_token;
    const expiresIn = payload?.expires_in || 3600;

    if (!accessToken) {
      return res.status(500).json({ error: "Auth provider did not return access token." });
    }

    setSessionCookie(res, accessToken, expiresIn);
    return res.status(200).json({
      ok: true,
      user: {
        id: payload?.user?.id,
        email: payload?.user?.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Auth provider request failed." });
  }
}
