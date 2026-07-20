// api/_analytics.js - Anonymized usage analytics
// Underscore-prefixed so Vercel doesn't deploy it as its own serverless
// function (see api/_trusted-sources.js for the same convention).
//
// Logs only categorical/boolean signals (destination, whether the question
// was compliance-related, whether the KB or live web search matched
// anything, whether the requester was signed in) plus a timestamp. No
// message content, no user identifiers — nothing here can be tied back to
// a specific scholar or conversation. Best-effort: a failed write never
// affects the chat response.

import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./_auth-utils.js";

const TABLE_NAME = "omanx_analytics_events";
const ANALYTICS_TIMEOUT_MS = 3000;

let _client = null;

function getClient() {
  if (_client) return _client;
  const config = getSupabasePublicConfig();
  if (!config) return null;
  _client = createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(ANALYTICS_TIMEOUT_MS) }) },
  });
  return _client;
}

export async function logAnalyticsEvent({ destination, compliance, kbMatched, webSearched, authenticated }) {
  const client = getClient();
  if (!client) return;

  try {
    const { error } = await client.from(TABLE_NAME).insert({
      destination,
      compliance: Boolean(compliance),
      kb_matched: Boolean(kbMatched),
      web_searched: Boolean(webSearched),
      authenticated: Boolean(authenticated),
    });
    // The Supabase client resolves with { error } on failure rather than
    // throwing, so a try/catch alone silently swallows write failures.
    if (error) console.warn("[OmanX] Analytics logging failed:", error.message);
  } catch (err) {
    console.warn("[OmanX] Analytics logging failed:", err.message);
  }
}
