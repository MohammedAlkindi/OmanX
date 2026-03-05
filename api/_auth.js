const COOKIE_NAME = "omanx_session";

function getSupabaseUrl() {
  const url = process.env.SUPABASE_URL;
  return url ? url.replace(/\/$/, "") : "";
}

function parseCookies(header = "") {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return acc;
      const key = part.slice(0, idx);
      const value = decodeURIComponent(part.slice(idx + 1));
      acc[key] = value;
      return acc;
    }, {});
}

export function setSessionCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=0`
  );
}

function extractToken(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[COOKIE_NAME] || null;
}

export async function requireAuth(req) {
  const token = extractToken(req);
  if (!token) {
    return { ok: false, status: 401, error: "Authentication required." };
  }

  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl || !process.env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: "Auth provider not configured." };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { ok: false, status: 401, error: "Invalid or expired session." };
    }

    const user = await response.json();

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      token,
    };
  } catch {
    return { ok: false, status: 500, error: "Auth provider unavailable." };
  }
}

export function requireAuthEnv() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
  return missing;
}
