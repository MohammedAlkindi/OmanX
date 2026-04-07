// auth/google.js — Initiate Google OAuth via Supabase

import { requireAuthEnv } from './_auth.js';

function wantsHtml(req) {
  const accept = req.headers.accept || '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    if (wantsHtml(req)) {
      return res.redirect(302, '/405.html');
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const missing = requireAuthEnv();
  if (missing.length) {
    if (wantsHtml(req)) {
      const message = encodeURIComponent(`Sign-in is temporarily unavailable. Missing: ${missing.join(', ')}`);
      return res.redirect(302, `/500.html?message=${message}`);
    }
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` });
  }

  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  const redirectTo =
    process.env.AUTH_REDIRECT_URL ||
    (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/workspace` : null);

  if (!redirectTo) {
    if (wantsHtml(req)) {
      const message = encodeURIComponent('Auth redirect URL is not configured.');
      return res.redirect(302, `/500.html?message=${message}`);
    }
    return res.status(500).json({ error: 'Auth redirect URL not configured.' });
  }

  const params = new URLSearchParams({ provider: 'google', redirect_to: redirectTo });
  res.redirect(302, `${supabaseUrl}/auth/v1/authorize?${params}`);
}
