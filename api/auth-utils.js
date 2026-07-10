import { createClient } from "@supabase/supabase-js";

let _supabase = null;

export function getSupabasePublicConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function getSupabaseClient() {
  if (_supabase) return _supabase;
  const config = getSupabasePublicConfig();
  if (!config) return null;
  _supabase = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return _supabase;
}

export function getBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

export function createSupabaseUserClient(token) {
  const config = getSupabasePublicConfig();
  if (!config || !token) return null;

  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

export function publicUser(user) {
  if (!user) return null;
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || "",
    name: meta.full_name || meta.name || user.email || "Signed-in scholar",
    avatarUrl: meta.avatar_url || meta.picture || "",
  };
}

export async function getAuthUser(req) {
  const token = getBearerToken(req);
  if (!token) return { user: null, token: "", error: null, configured: !!getSupabasePublicConfig() };

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { user: null, token, error: "Supabase authentication is not configured.", configured: false };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, token, error: "Invalid or expired session.", configured: true };
  }

  return { user: data.user, token, error: null, configured: true };
}
