// api/trusted-sources.js - Shared trusted-domain allowlist and source classification
// Used by api/chat.js (compliance search) and api/news.js (destination news feed)
// so the two never drift on which domains count as "official".

export const DESTINATION_DOMAINS = {
  us: [
    "uscis.gov", "ice.gov", "dhs.gov", "studyinthestates.dhs.gov",
    "state.gov", "travel.state.gov", "studentaid.gov", "irs.gov", "dol.gov",
  ],
  uk: ["gov.uk", "ukcisa.org.uk"],
  au: [
    "homeaffairs.gov.au", "immi.homeaffairs.gov.au", "studyaustralia.gov.au",
    "teqsa.gov.au", "asqa.gov.au", "oso.gov.au",
  ],
};

export const TRUSTED_DOMAINS = Object.values(DESTINATION_DOMAINS).flat();

export function sourceCategory(url = "") {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (hostname.endsWith(".gov") || hostname.includes("gov.uk") || hostname.includes("homeaffairs.gov.au")) return "Government";
    if (hostname.includes("mohe") || hostname.endsWith(".edu.om")) return "MoHE";
    if (hostname.endsWith(".edu") || hostname.includes(".ac.uk") || hostname.includes(".edu.au")) return "University";
    return "Official web";
  } catch {
    return "Official web";
  }
}
