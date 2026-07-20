import { getSupabasePublicConfig } from "../_auth-utils.js";

export default function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const config = getSupabasePublicConfig();
  const siteUrl = process.env.PUBLIC_SITE_URL || process.env.ALLOWED_ORIGIN || "";
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    enabled: !!config,
    supabaseUrl: config?.url || "",
    supabaseKey: config?.key || "",
    siteUrl,
  });
}
