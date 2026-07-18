// api/news.js - Destination visa/immigration news feed for the /news page
// Scoped to the same trusted government/university domains used for compliance
// search in api/chat.js. Cached in-memory since policy news doesn't need
// per-request freshness.

import { DESTINATION_DOMAINS, sourceCategory } from "./trusted-sources.js";

const DESTINATION_QUERIES = {
  us: "F-1 international student visa OPT CPT SEVIS policy announcement",
  uk: "UK student visa policy update UKVI immigration rules",
  au: "Australia student visa policy update subclass 500 immigration rules",
};

const DESTINATION_LABELS = { us: "US", uk: "UK", au: "AU" };
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// Tavily's news-topic search falls back to "recent + tagged news" on broad
// domains like dhs.gov/state.gov when nothing tightly matches the query, so
// results need a second relevance pass before they reach scholars.
const RELEVANCE_KEYWORDS = [
  "visa", "student", "immigration", "opt", "cpt", "sevis", "f-1", "f1 ",
  "international student", "study permit", "graduate route", "subclass 500",
  "ukvi", "uscis", "study visa", "sponsor",
];

function isRelevant(item) {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return RELEVANCE_KEYWORDS.some((kw) => haystack.includes(kw));
}

let _cache = { ts: 0, payload: null };

async function fetchDestinationNews(destination) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: DESTINATION_QUERIES[destination],
        topic: "news",
        days: 30,
        search_depth: "advanced",
        include_answer: false,
        include_domains: DESTINATION_DOMAINS[destination],
        max_results: 5,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[OmanX] News search failed for ${destination}:`, res.status);
      return [];
    }

    const data = await res.json();
    return (data.results || [])
      .map((r) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: (r.content || "").slice(0, 220),
        publishedDate: r.published_date || null,
        destination: DESTINATION_LABELS[destination],
        category: sourceCategory(r.url),
      }))
      .filter(isRelevant);
  } catch (err) {
    console.warn(`[OmanX] News search error for ${destination}:`, err.message);
    return [];
  }
}

function sortByRecency(items) {
  return [...items].sort((a, b) => {
    const ta = a.publishedDate ? Date.parse(a.publishedDate) : NaN;
    const tb = b.publishedDate ? Date.parse(b.publishedDate) : NaN;
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return tb - ta;
    if (!Number.isNaN(ta)) return -1;
    if (!Number.isNaN(tb)) return 1;
    return 0;
  });
}

async function buildNewsPayload() {
  const configured = Boolean(process.env.TAVILY_API_KEY);
  if (!configured) {
    return { configured: false, fetchedAt: Date.now(), items: [] };
  }

  const destinations = Object.keys(DESTINATION_QUERIES);
  const results = await Promise.all(destinations.map(fetchDestinationNews));
  return { configured: true, fetchedAt: Date.now(), items: sortByRecency(results.flat()) };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (_cache.payload && Date.now() - _cache.ts < CACHE_TTL) {
      return res.json(_cache.payload);
    }

    const payload = await buildNewsPayload();
    if (payload.configured) {
      _cache = { ts: Date.now(), payload };
    }
    return res.json(payload);
  } catch (err) {
    console.error("[OmanX] /api/news error:", err.message);
    if (_cache.payload) return res.json(_cache.payload);
    return res.status(500).json({ error: "Failed to load news", items: [] });
  }
}
