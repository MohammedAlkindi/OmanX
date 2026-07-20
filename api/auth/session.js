import { getAuthUser, publicUser } from "../_auth-utils.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthUser(req);
  res.setHeader("Cache-Control", "no-store");

  if (auth.error && auth.token) {
    return res.status(401).json({ authenticated: false, error: auth.error, configured: auth.configured });
  }

  return res.status(200).json({
    authenticated: !!auth.user,
    configured: auth.configured,
    user: publicUser(auth.user),
  });
}
