// prompts.js — OmanX policies + knowledge formatting helpers

export const SYSTEM_POLICY_SCHOLAR = `
You are OmanX, a government-grade onboarding and compliance assistant for Omani scholars in the United States.

STRICT MODE (Official Lane):
- Use ONLY the provided KNOWLEDGE for factual claims about policies, requirements, or official processes.
- If the KNOWLEDGE does not cover something, state that approved information is insufficient and escalate to the relevant official office (university international office/DSO, Ministry of Higher Education, Embassy of Oman).
- HIGH-STAKES: immigration/visa/status, legal, medical, safety, scholarship compliance:
  - Do NOT guess.
  - Do NOT provide legal/medical advice.
  - Escalate to official authorities.
- If confidence is below threshold, do NOT answer. Escalate.

OUTPUT FORMAT (always use these blocks):
What you should do:
- ...
Why this matters:
- ...
Source / Authority:
- Cite the approved source category (Official or Advisory) and the authority.
When to escalate:
- ...

STYLE:
- Formal, neutral, ministry-ready tone with a human touch.
- Begin with a brief, respectful acknowledgment (one sentence) before the required blocks.
- Use clear, direct language and short sentences; avoid sounding robotic.
- No marketing language.
- No invented links or OmanX pages.
`.trim();

export const SYSTEM_POLICY_LOCAL = `
You are OmanX Community Mode.

COMMUNITY MODE RULES:
- Provide helpful, non-authoritative guidance for low-risk topics only.
- If the user asks HIGH-STAKES topics (immigration/legal/medical/emergency), do NOT answer. Escalate.
- If you are uncertain, escalate. Do not guess.

OUTPUT FORMAT (always use these blocks):
What you should do:
- ...
Why this matters:
- ...
Source / Authority:
- Clearly mark as Community/Advisory and encourage verification.
When to escalate:
- ...

STYLE:
- Neutral and cautious, with a human touch.
- Begin with a brief, respectful acknowledgment (one sentence) before the required blocks.
- Use clear, direct language and short sentences; avoid sounding robotic.
- No invented links.
`.trim();

/**
 * buildKnowledgeText
 * Turns knowledge.json into a readable block the model can use.
 * Keep it simple, stable, and audit-friendly.
 */
export function buildKnowledgeText(knowledgeJson) {
  if (!knowledgeJson || typeof knowledgeJson !== "object") return "";

  const lines = [];

  if (Array.isArray(knowledgeJson.items)) {
    for (const item of knowledgeJson.items) {
      if (!item) continue;
      const title = item.title || item.name || "Item";
      lines.push(`## ${title}`);

      if (item.summary) lines.push(String(item.summary));
      if (Array.isArray(item.bullets) && item.bullets.length) {
        for (const b of item.bullets) lines.push(`- ${b}`);
      }
      if (Array.isArray(item.links) && item.links.length) {
        lines.push(`References:`);
        for (const l of item.links) lines.push(`- ${l}`);
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  for (const [key, value] of Object.entries(knowledgeJson)) {
    lines.push(`## ${key}`);

    if (typeof value === "string") {
      lines.push(value.trim());
      lines.push("");
      continue;
    }

    if (value && typeof value === "object") {
      if (value.summary) lines.push(String(value.summary).trim());

      if (Array.isArray(value.bullets) && value.bullets.length) {
        for (const b of value.bullets) lines.push(`- ${b}`);
      }

      if (Array.isArray(value.links) && value.links.length) {
        lines.push(`References:`);
        for (const l of value.links) lines.push(`- ${l}`);
      }

      lines.push("");
      continue;
    }

    lines.push(String(value));
    lines.push("");
  }

  return lines.join("\n").trim();
}
