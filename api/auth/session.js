// api/auth/session.js


import { requireAuth } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ authenticated: false, error: auth.error });
  }

  return res.status(200).json({ authenticated: true, user: auth.user });
}
