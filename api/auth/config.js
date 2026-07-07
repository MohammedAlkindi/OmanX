import { getSupabasePublicConfig } from "../auth-utils.js";

export default function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const config = getSupabasePublicConfig();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    enabled: !!config,
    supabaseUrl: config?.url || "",
    supabaseKey: config?.key || "",
  });
}
